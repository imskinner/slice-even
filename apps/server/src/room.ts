import {
  cutError,
  generateObject,
  meshVolume,
  objectSeed,
  OBJECT_KINDS,
  parseCutPlane,
  precisionStars,
  ruleTarget,
  scoreCut,
  scoreThirds,
  type CutResult,
  type ObjectKind,
  type Plane,
  type RoundRule,
} from "@slice-even/core";
import { LIMITS, revealSchedule, type RoomState } from "./protocol.ts";

/**
 * A room's whole game state and rules, with no Cloudflare APIs in sight so
 * it can be unit tested. The Durable Object stores this object and calls
 * these functions; `now` and randomness are always passed in.
 *
 * Scoring: every cut earns up to three precision stars, and in round N a
 * star is worth N points, so everyone scores by how well they cut and
 * whoever is behind can still come back in the later rounds. On top of
 * that the round's podium takes a bonus (the TV show's rule): N, N/2, N/4.
 */

export interface PlayerRecord {
  id: string;
  /** Secret chosen by the client on first join; reconnections must repeat it. */
  token: string;
  name: string;
  wins: number;
  score: number;
  lastCutRound: number;
  joinedAt: number;
  /** Present for computer players (see bots.ts). */
  bot?: { level: "easy" | "medium" | "hard" };
}

export interface RoundRecord {
  number: number;
  kind: ObjectKind;
  seed: string;
  rule: RoundRule;
  status: "cutting" | "scored";
  startedAt: number;
  /** Server clock; includes LIMITS.graceMs of slack. */
  deadline: number;
  winnerId: string | null;
  participants: string[];
  points: Record<string, number>;
  nextStartAt: number | null;
  /** When the round was scored; absent while cutting and in rooms saved before this existed. */
  scoredAt?: number;
  /** When each bot in this round will cut (bots.ts fills it in). */
  botPlans: { playerId: string; at: number }[];
}

export interface CutRecord {
  round: number;
  playerId: string;
  plane: Plane;
  /** "Thirds" rounds: the second cut, and the slice between the two. */
  plane2?: Plane;
  massMid?: number;
  massFront: number;
  massBack: number;
  error: number;
  submittedAt: number;
}

export interface RoomData {
  code: string;
  hostId: string | null;
  status: "lobby" | "playing" | "finished";
  totalRounds: number;
  roundSeconds: number;
  players: PlayerRecord[];
  rounds: RoundRecord[];
  cuts: CutRecord[];
  lastActivity: number;
  /** Quick-play table: starts on its own and fills empty seats with bots. */
  public: boolean;
  /** Public tables start at this time (set when the first person arrives). */
  autoStartAt: number | null;
  /** Which game this is in the room: 1, then +1 per rematch (absent in older rooms). */
  game?: number;
}

/** A rule was broken; the message is shown to the player as is. */
export class RoomError extends Error {}

/** Public tables wait this long after the first person arrives, so friends can join. */
export const PUBLIC_COUNTDOWN_MS = 15_000;

export function createRoomData(code: string, totalRounds: number, now: number, isPublic = false): RoomData {
  const rounds = Math.round(totalRounds);
  if (!(rounds >= LIMITS.minRounds && rounds <= LIMITS.maxRounds)) throw new RoomError("Número de rodadas inválido.");
  return {
    code,
    hostId: null,
    status: "lobby",
    totalRounds: rounds,
    roundSeconds: LIMITS.roundSeconds,
    players: [],
    rounds: [],
    cuts: [],
    lastActivity: now,
    public: isPublic,
    autoStartAt: null,
  };
}

export function currentRound(data: RoomData): RoundRecord | null {
  return data.rounds.at(-1) ?? null;
}

/**
 * Adds a player, or reconnects one. The first player to join is the host.
 * Newcomers can join until the game is over; mid-game they play from the
 * next round.
 */
export function join(data: RoomData, playerId: string, token: string, rawName: string, now: number): PlayerRecord {
  const name = rawName.trim();
  if (!name || name.length > LIMITS.maxName) throw new RoomError("Nome inválido.");
  if (!playerId || !token) throw new RoomError("Identidade inválida.");

  const existing = data.players.find((p) => p.id === playerId);
  if (existing) {
    if (existing.token !== token) throw new RoomError("Esse jogador já está na sala em outro aparelho.");
    existing.name = name;
    data.lastActivity = now;
    return existing;
  }
  if (data.status === "finished") throw new RoomError("Essa partida já acabou.");
  if (data.players.length >= LIMITS.maxPlayers) throw new RoomError(`A sala está cheia (máximo ${LIMITS.maxPlayers}).`);

  const player: PlayerRecord = { id: playerId, token, name, wins: 0, score: 0, lastCutRound: 0, joinedAt: now };
  data.players.push(player);
  data.hostId ??= playerId;
  if (data.public && data.status === "lobby") data.autoStartAt ??= now + PUBLIC_COUNTDOWN_MS;
  data.lastActivity = now;
  return player;
}

const TARGETS = [0.25, 0.3, 1 / 3, 0.4];
const GRAM_SHARES = [0.2, 0.25, 0.3, 0.35, 0.4];
/** Spinning only matters for shapes that are not round: these are the long ones. */
const LONG_KINDS: ObjectKind[] = ["banana", "carrot", "cucumber", "bread"];

/**
 * The twist for round `number`: the first is always classic so newcomers
 * learn the basic goal, the last gives everyone the same object for a
 * head-to-head finale, and the ones in between are drawn from a weighted roulette.
 */
export function pickRule(number: number, total: number, random: () => number): RoundRule {
  if (number === 1) return { type: "classic" };
  if (number === total && total > 1) return { type: "twin" };
  const roulette: [number, () => RoundRule][] = [
    [3, () => ({ type: "classic" })],
    [3, () => ({ type: "target", target: TARGETS[Math.floor(random() * TARGETS.length)]! })],
    [1.5, () => ({ type: "blitz" })],
    [1.5, () => ({ type: "blind" })],
    [2, () => ({ type: "twin" })],
    [2, () => ({ type: "grams", share: GRAM_SHARES[Math.floor(random() * GRAM_SHARES.length)]! })],
    [1.5, () => ({ type: "spin" })],
    [1.5, () => ({ type: "thirds" })],
  ];
  let r = random() * roulette.reduce((s, [w]) => s + w, 0);
  for (const [w, make] of roulette) {
    if ((r -= w) < 0) return make();
  }
  return { type: "classic" };
}

function pickKind(rule: RoundRule, random: () => number): ObjectKind {
  const kinds = rule.type === "spin" ? LONG_KINDS : OBJECT_KINDS;
  return kinds[Math.floor(random() * kinds.length)]!;
}

/**
 * Starts the next round. `playerId` is the host pressing the button, or null
 * when the alarm starts it on its own after the previous round's reveal.
 */
export function startRound(
  data: RoomData,
  playerId: string | null,
  now: number,
  seed: string,
  random: () => number,
): RoundRecord {
  const previous = currentRound(data);
  if (playerId !== null && data.hostId !== playerId) throw new RoomError("Só quem criou a sala pode começar.");
  const autoTime =
    data.status === "lobby" ? data.autoStartAt !== null && now >= data.autoStartAt : !!previous?.nextStartAt && now >= previous.nextStartAt;
  if (playerId === null && !autoTime) throw new RoomError("Ainda não é hora da próxima rodada.");
  if (data.status === "finished" || data.rounds.length >= data.totalRounds) throw new RoomError("A partida acabou.");
  if (previous?.status === "cutting") throw new RoomError("A rodada atual ainda não terminou.");
  if (data.players.length === 0) throw new RoomError("Não há jogadores na sala.");

  const number = data.rounds.length + 1;
  const rule = pickRule(number, data.totalRounds, random);
  const seconds = rule.type === "blitz" ? LIMITS.blitzSeconds : data.roundSeconds;
  if (previous) previous.nextStartAt = null;
  const round: RoundRecord = {
    number,
    kind: pickKind(rule, random),
    seed,
    rule,
    status: "cutting",
    startedAt: now,
    deadline: now + seconds * 1000 + LIMITS.graceMs,
    winnerId: null,
    participants: data.players.map((p) => p.id),
    points: {},
    nextStartAt: null,
    botPlans: [],
  };
  data.rounds.push(round);
  data.status = "playing";
  data.autoStartAt = null;
  data.lastActivity = now;
  return round;
}

/**
 * Scores a cut by regenerating the player's object from the round seed, so
 * the client only ever sends a plane. Closes the round when everyone is in.
 */
export function submitCut(
  data: RoomData,
  playerId: string,
  roundNumber: number,
  planeInput: unknown,
  now: number,
  /** The second cut, in "thirds" rounds. */
  plane2Input?: unknown,
): CutResult {
  const player = data.players.find((p) => p.id === playerId);
  if (!player) throw new RoomError("Você não está nesta sala.");
  const round = currentRound(data);
  if (!round || round.number !== roundNumber || round.status !== "cutting") throw new RoomError("A rodada já acabou.");
  if (!round.participants.includes(playerId)) throw new RoomError("Você entra na próxima rodada.");
  if (now > round.deadline) throw new RoomError("O tempo acabou!");
  if (data.cuts.some((c) => c.round === round.number && c.playerId === playerId)) {
    throw new RoomError("Você já cortou nesta rodada.");
  }
  const parsed = parseCutPlane(planeInput);
  if ("error" in parsed) throw new RoomError(`Corte inválido: ${parsed.error}`);

  const object = generateObject(round.kind, objectSeed(round.seed, playerId, round.rule));
  let score: CutResult;
  let plane2: Plane | undefined;
  if (round.rule.type === "thirds") {
    const second = parseCutPlane(plane2Input);
    if ("error" in second) throw new RoomError(`Corte inválido: ${second.error}`);
    const thirds = scoreThirds(object.mesh, parsed.plane, second.plane, object.density);
    if (!thirds) throw new RoomError("Os dois cortes precisam ser paralelos.");
    score = thirds;
    plane2 = second.plane;
  } else {
    const raw = scoreCut(object.mesh, parsed.plane, object.density);
    const mass = meshVolume(object.mesh) * object.density;
    score = { ...raw, error: cutError(raw, ruleTarget(round.rule, mass)) };
  }
  data.cuts.push({
    round: round.number,
    playerId,
    plane: parsed.plane,
    plane2,
    massMid: score.massMid,
    massFront: score.massFront,
    massBack: score.massBack,
    error: score.error,
    submittedAt: now,
  });
  player.lastCutRound = round.number;
  data.lastActivity = now;
  finalizeRound(data, now);
  return score;
}

/**
 * Podium bonus in round N: the winner takes N (the TV show's rule), second
 * gets half, third a quarter, rounded down.
 */
export function placementPoints(roundNumber: number, place: number): number {
  return place > 2 ? 0 : Math.floor(roundNumber / 2 ** place);
}

/**
 * What a cut earns: its precision stars at the round's value, plus the
 * podium bonus. A miss (error 1) earns nothing, even if a small table
 * leaves it on the podium.
 */
export function cutPoints(roundNumber: number, place: number, error: number): number {
  if (error >= 1) return 0;
  return roundNumber * precisionStars(error) + placementPoints(roundNumber, place);
}

/** How long clients spend revealing the results, so the next round waits for it. */
export function revealDuration(players: number): number {
  return revealSchedule(players).total + LIMITS.revealBaseMs;
}

/** Ranks the current round if everyone cut or time is up. Returns whether it closed. */
export function finalizeRound(data: RoomData, now: number): boolean {
  const round = currentRound(data);
  if (!round || round.status !== "cutting") return false;
  const cuts = data.cuts.filter((c) => c.round === round.number);
  if (now < round.deadline && cuts.length < round.participants.length) return false;

  const ranked = [...cuts].sort((a, b) => a.error - b.error || a.submittedAt - b.submittedAt);
  ranked.forEach((cut, place) => {
    const earned = cutPoints(round.number, place, cut.error);
    round.points[cut.playerId] = earned;
    const player = data.players.find((p) => p.id === cut.playerId);
    if (player) player.score += earned;
  });
  round.status = "scored";
  round.scoredAt = now;
  round.winnerId = ranked[0]?.playerId ?? null;
  if (ranked[0]) {
    const winner = data.players.find((p) => p.id === ranked[0]!.playerId);
    if (winner) winner.wins += 1;
  }
  if (data.rounds.length >= data.totalRounds) data.status = "finished";
  else round.nextStartAt = now + revealDuration(round.participants.length) + LIMITS.betweenRoundsMs;
  data.lastActivity = now;
  return true;
}

/**
 * After a finished game: back to the lobby in the same room, scores cleared.
 * Bots and whoever is still connected stay; people who left are dropped so
 * they are not waited for every round. Anyone may ask; if the host is gone,
 * whoever asked takes over.
 */
export function rematch(data: RoomData, playerId: string, now: number, online: ReadonlySet<string>): void {
  if (!data.players.some((p) => p.id === playerId)) throw new RoomError("Você não está nesta sala.");
  if (data.status !== "finished") throw new RoomError("A partida ainda não acabou.");
  data.players = data.players.filter((p) => p.bot !== undefined || p.id === playerId || online.has(p.id));
  for (const p of data.players) {
    p.score = 0;
    p.wins = 0;
    p.lastCutRound = 0;
  }
  if (!data.players.some((p) => p.id === data.hostId)) data.hostId = playerId;
  data.rounds = [];
  data.cuts = [];
  data.status = "lobby";
  data.game = (data.game ?? 1) + 1;
  data.autoStartAt = data.public ? now + PUBLIC_COUNTDOWN_MS : null;
  data.lastActivity = now;
}

/** When the Durable Object should wake up next: round deadline, next round, or idle cleanup. */
export function nextAlarm(data: RoomData): number {
  const round = currentRound(data);
  const cleanup = data.lastActivity + LIMITS.idleMs;
  if (round?.status === "cutting") {
    // `?? []`: rooms saved before bots existed have no plans.
    const nextBot = Math.min(...(round.botPlans ?? []).map((p) => p.at));
    return Math.min(round.deadline, cleanup, nextBot);
  }
  if (data.status === "lobby" && data.autoStartAt) return Math.min(data.autoStartAt, cleanup);
  if (round?.nextStartAt) return Math.min(round.nextStartAt, cleanup);
  return cleanup;
}

export function isIdle(data: RoomData, now: number): boolean {
  return now - data.lastActivity >= LIMITS.idleMs;
}

/** What one player is allowed to see: everything except other players' unscored cuts and tokens. */
export function publicView(data: RoomData, viewerId: string, online: ReadonlySet<string>): RoomState {
  const iso = (t: number) => new Date(t).toISOString();
  const scored = new Set(data.rounds.filter((r) => r.status === "scored").map((r) => r.number));
  // Unique across rematches, so clients never mistake a new round 1 for the old one.
  const roundId = (n: number) => `${data.code}:${data.game ?? 1}:${n}`;
  return {
    room: {
      code: data.code,
      host_id: data.hostId ?? "",
      public: data.public,
      auto_start_at: data.autoStartAt ? iso(data.autoStartAt) : null,
      status: data.status,
      total_rounds: data.totalRounds,
      round_seconds: data.roundSeconds,
      current_round: data.rounds.length,
    },
    players: data.players.map((p) => ({
      user_id: p.id,
      name: p.name,
      wins: p.wins,
      score: p.score,
      last_cut_round: p.lastCutRound,
      joined_at: iso(p.joinedAt),
      online: p.bot !== undefined || online.has(p.id),
      bot: p.bot !== undefined,
    })),
    rounds: data.rounds.map((r) => ({
      id: roundId(r.number),
      number: r.number,
      kind: r.kind,
      seed: r.seed,
      rule: r.rule,
      status: r.status,
      started_at: iso(r.startedAt),
      deadline: iso(r.deadline),
      winner_id: r.winnerId,
      participants: r.participants,
      points: r.points,
      next_start_at: r.nextStartAt ? iso(r.nextStartAt) : null,
      scored_at: r.scoredAt ? iso(r.scoredAt) : null,
    })),
    cuts: data.cuts
      .filter((c) => c.playerId === viewerId || scored.has(c.round))
      .map((c) => ({
        round_id: roundId(c.round),
        user_id: c.playerId,
        plane: c.plane,
        plane2: c.plane2,
        mass_mid: c.massMid,
        mass_front: c.massFront,
        mass_back: c.massBack,
        error: c.error,
      })),
  };
}
