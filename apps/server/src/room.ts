import {
  cutError,
  generateObject,
  objectSeed,
  OBJECT_KINDS,
  parseCutPlane,
  ruleTarget,
  scoreCut,
  type CutResult,
  type ObjectKind,
  type Plane,
  type RoundRule,
} from "@slice-even/core";
import { LIMITS, type RoomState } from "./protocol.ts";

/**
 * A room's whole game state and rules, with no Cloudflare APIs in sight so
 * it can be unit tested. The Durable Object stores this object and calls
 * these functions; `now` and randomness are always passed in.
 *
 * Scoring follows the TV show: round N is worth N points to its winner, so
 * whoever is behind can always come back in the later rounds.
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
}

export interface CutRecord {
  round: number;
  playerId: string;
  plane: Plane;
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
}

/** A rule was broken; the message is shown to the player as is. */
export class RoomError extends Error {}

export function createRoomData(code: string, totalRounds: number, now: number): RoomData {
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
  data.lastActivity = now;
  return player;
}

const TARGETS = [0.25, 0.3, 1 / 3, 0.4];

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
  ];
  let r = random() * roulette.reduce((s, [w]) => s + w, 0);
  for (const [w, make] of roulette) {
    if ((r -= w) < 0) return make();
  }
  return { type: "classic" };
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
  if (playerId === null && (!previous?.nextStartAt || now < previous.nextStartAt)) {
    throw new RoomError("Ainda não é hora da próxima rodada.");
  }
  if (data.status === "finished" || data.rounds.length >= data.totalRounds) throw new RoomError("A partida acabou.");
  if (previous?.status === "cutting") throw new RoomError("A rodada atual ainda não terminou.");
  if (data.players.length === 0) throw new RoomError("Não há jogadores na sala.");

  const number = data.rounds.length + 1;
  const rule = pickRule(number, data.totalRounds, random);
  const seconds = rule.type === "blitz" ? LIMITS.blitzSeconds : data.roundSeconds;
  if (previous) previous.nextStartAt = null;
  const round: RoundRecord = {
    number,
    kind: OBJECT_KINDS[Math.floor(random() * OBJECT_KINDS.length)]!,
    seed,
    rule,
    status: "cutting",
    startedAt: now,
    deadline: now + seconds * 1000 + LIMITS.graceMs,
    winnerId: null,
    participants: data.players.map((p) => p.id),
    points: {},
    nextStartAt: null,
  };
  data.rounds.push(round);
  data.status = "playing";
  data.lastActivity = now;
  return round;
}

/**
 * Scores a cut by regenerating the player's object from the round seed, so
 * the client only ever sends a plane. Closes the round when everyone is in.
 */
export function submitCut(data: RoomData, playerId: string, roundNumber: number, planeInput: unknown, now: number): CutResult {
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
  const raw = scoreCut(object.mesh, parsed.plane, object.density);
  const score: CutResult = { ...raw, error: cutError(raw, ruleTarget(round.rule)) };
  data.cuts.push({
    round: round.number,
    playerId,
    plane: parsed.plane,
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

/** Bonus point for a cut within 1% of the goal, win or lose. */
export const PRECISION_BONUS_ERROR = 0.01;

/**
 * Points for a finishing position in round N: the winner takes N (the TV
 * show's rule), second gets half, third a quarter, rounded down.
 */
export function placementPoints(roundNumber: number, place: number): number {
  return place > 2 ? 0 : Math.floor(roundNumber / 2 ** place);
}

/** How long clients spend revealing the results, so the next round waits for it. */
export function revealDuration(players: number): number {
  return LIMITS.revealBaseMs + LIMITS.revealPerPlayerMs * players;
}

/** Ranks the current round if everyone cut or time is up. Returns whether it closed. */
export function finalizeRound(data: RoomData, now: number): boolean {
  const round = currentRound(data);
  if (!round || round.status !== "cutting") return false;
  const cuts = data.cuts.filter((c) => c.round === round.number);
  if (now < round.deadline && cuts.length < round.participants.length) return false;

  const ranked = [...cuts].sort((a, b) => a.error - b.error || a.submittedAt - b.submittedAt);
  ranked.forEach((cut, place) => {
    const earned = placementPoints(round.number, place) + (cut.error < PRECISION_BONUS_ERROR ? 1 : 0);
    round.points[cut.playerId] = earned;
    const player = data.players.find((p) => p.id === cut.playerId);
    if (player) player.score += earned;
  });
  round.status = "scored";
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

/** When the Durable Object should wake up next: round deadline, next round, or idle cleanup. */
export function nextAlarm(data: RoomData): number {
  const round = currentRound(data);
  const cleanup = data.lastActivity + LIMITS.idleMs;
  if (round?.status === "cutting") return Math.min(round.deadline, cleanup);
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
  const roundId = (n: number) => `${data.code}:${n}`;
  return {
    room: {
      code: data.code,
      host_id: data.hostId ?? "",
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
      online: online.has(p.id),
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
    })),
    cuts: data.cuts
      .filter((c) => c.playerId === viewerId || scored.has(c.round))
      .map((c) => ({
        round_id: roundId(c.round),
        user_id: c.playerId,
        plane: c.plane,
        mass_front: c.massFront,
        mass_back: c.massBack,
        error: c.error,
      })),
  };
}
