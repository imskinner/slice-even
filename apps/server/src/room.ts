import {
  generateObject,
  OBJECT_KINDS,
  parseCutPlane,
  playerSeed,
  scoreCut,
  type CutResult,
  type ObjectKind,
  type Plane,
} from "@slice-even/core";
import { LIMITS, type RoomState } from "./protocol.ts";

/**
 * A room's whole game state and rules, with no Cloudflare APIs in sight so
 * it can be unit tested. The Durable Object stores this object and calls
 * these functions; `now` is always passed in.
 */

export interface PlayerRecord {
  id: string;
  /** Secret chosen by the client on first join; reconnections must repeat it. */
  token: string;
  name: string;
  wins: number;
  lastCutRound: number;
  joinedAt: number;
}

export interface RoundRecord {
  number: number;
  kind: ObjectKind;
  seed: string;
  status: "cutting" | "scored";
  startedAt: number;
  /** Server clock; includes LIMITS.graceMs of slack. */
  deadline: number;
  winnerId: string | null;
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
 * New players can only join in the lobby; returning ones can come back anytime.
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
  if (data.status !== "lobby") throw new RoomError("Essa partida já começou.");
  if (data.players.length >= LIMITS.maxPlayers) throw new RoomError(`A sala está cheia (máximo ${LIMITS.maxPlayers}).`);

  const player: PlayerRecord = { id: playerId, token, name, wins: 0, lastCutRound: 0, joinedAt: now };
  data.players.push(player);
  data.hostId ??= playerId;
  data.lastActivity = now;
  return player;
}

export function startRound(data: RoomData, playerId: string, now: number, seed: string, random: () => number): RoundRecord {
  if (data.hostId !== playerId) throw new RoomError("Só quem criou a sala pode começar.");
  if (data.status === "finished" || data.rounds.length >= data.totalRounds) throw new RoomError("A partida acabou.");
  if (currentRound(data)?.status === "cutting") throw new RoomError("A rodada atual ainda não terminou.");

  const round: RoundRecord = {
    number: data.rounds.length + 1,
    kind: OBJECT_KINDS[Math.floor(random() * OBJECT_KINDS.length)]!,
    seed,
    status: "cutting",
    startedAt: now,
    deadline: now + data.roundSeconds * 1000 + LIMITS.graceMs,
    winnerId: null,
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
  if (now > round.deadline) throw new RoomError("O tempo acabou!");
  if (data.cuts.some((c) => c.round === round.number && c.playerId === playerId)) {
    throw new RoomError("Você já cortou nesta rodada.");
  }
  const parsed = parseCutPlane(planeInput);
  if ("error" in parsed) throw new RoomError(`Corte inválido: ${parsed.error}`);

  const object = generateObject(round.kind, playerSeed(round.seed, playerId));
  const score = scoreCut(object.mesh, parsed.plane, object.density);
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

/** Ranks the current round if everyone cut or time is up. Returns whether it closed. */
export function finalizeRound(data: RoomData, now: number): boolean {
  const round = currentRound(data);
  if (!round || round.status !== "cutting") return false;
  const cuts = data.cuts.filter((c) => c.round === round.number);
  if (now < round.deadline && cuts.length < data.players.length) return false;

  const best = [...cuts].sort((a, b) => a.error - b.error || a.submittedAt - b.submittedAt)[0];
  round.status = "scored";
  round.winnerId = best?.playerId ?? null;
  if (best) data.players.find((p) => p.id === best.playerId)!.wins += 1;
  if (data.rounds.length >= data.totalRounds) data.status = "finished";
  data.lastActivity = now;
  return true;
}

/** When the Durable Object should wake up next: round deadline or idle cleanup. */
export function nextAlarm(data: RoomData): number {
  const round = currentRound(data);
  const cleanup = data.lastActivity + LIMITS.idleMs;
  return round?.status === "cutting" ? Math.min(round.deadline, cleanup) : cleanup;
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
      last_cut_round: p.lastCutRound,
      joined_at: iso(p.joinedAt),
      online: online.has(p.id),
    })),
    rounds: data.rounds.map((r) => ({
      id: roundId(r.number),
      number: r.number,
      kind: r.kind,
      seed: r.seed,
      status: r.status,
      started_at: iso(r.startedAt),
      deadline: iso(r.deadline),
      winner_id: r.winnerId,
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
