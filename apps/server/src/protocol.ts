import type { CutResult, ObjectKind, Plane, RoundRule } from "@slice-even/core";

/**
 * Wire format between the browser and a room's Durable Object. The shapes
 * of the public state follow what the UI renders.
 */

export interface Room {
  code: string;
  /** Quick-play table: starts by itself and fills empty seats with bots. */
  public: boolean;
  /** When a public table starts on its own. */
  auto_start_at: string | null;
  host_id: string;
  status: "lobby" | "playing" | "finished";
  total_rounds: number;
  round_seconds: number;
  current_round: number;
}

export interface Player {
  user_id: string;
  name: string;
  wins: number;
  /** Game score: round N is worth N points (see LIMITS / room.ts). */
  score: number;
  last_cut_round: number;
  joined_at: string;
  online: boolean;
  /** Computer player. */
  bot: boolean;
}

export interface Round {
  id: string;
  number: number;
  kind: ObjectKind;
  /** Each player's object comes from playerSeed(seed, user_id) in core. */
  seed: string;
  rule: RoundRule;
  status: "cutting" | "scored";
  started_at: string;
  deadline: string;
  winner_id: string | null;
  /** Players who were in the room when the round started (late joiners wait). */
  participants: string[];
  /** Points earned this round, by player id, once scored. */
  points: Record<string, number>;
  /** When the next round starts on its own, if there is one. */
  next_start_at: string | null;
}

export interface Cut {
  round_id: string;
  user_id: string;
  plane: Plane;
  mass_front: number;
  mass_back: number;
  /** Distance from the round's goal (see cutError in core). */
  error: number;
}

export interface RoomState {
  room: Room;
  players: Player[];
  rounds: Round[];
  /** Your own cuts, plus everyone's for rounds that are already scored. */
  cuts: Cut[];
}

export type ClientMessage =
  | { type: "join"; playerId: string; token: string; name: string }
  | { type: "start" }
  | { type: "cut"; requestId: string; round: number; plane: unknown }
  | { type: "react"; emoji: string }
  | { type: "addBot"; level: "easy" | "medium" | "hard" }
  | { type: "removeBot"; playerId: string }
  /** Where your knife is while aiming; relayed to the others as a ghost. */
  | { type: "aim"; x: number; z: number; angle: number }
  | { type: "ping" };

export type ServerMessage =
  | { type: "state"; state: RoomState; you: string; serverTime: number }
  | { type: "cutResult"; requestId: string; score: CutResult }
  /** Someone reacted; relayed to everyone, never stored. */
  | { type: "reaction"; from: string; name: string; emoji: string }
  /** Another player's knife position while aiming (not stored). */
  | { type: "aim"; from: string; x: number; z: number; angle: number }
  /** A failed action; the connection stays open. */
  | { type: "error"; requestId?: string; message: string }
  /** The connection cannot continue (room missing, full, already started). */
  | { type: "fatal"; message: string }
  | { type: "pong" };

/** GET /api/daily and POST /api/daily responses. */
export interface DailyResponse {
  puzzle: { date: string; number: number; kind: ObjectKind; seed: string };
  leaderboard: { name: string; error: number; you: boolean }[];
  total: number;
  /** Your result, once you have played today. */
  mine: { score: CutResult; rank: number; total: number; beat: number; plane?: Plane } | null;
  /** Milliseconds until the next challenge. */
  nextInMs: number;
}

/** The only reactions the server relays. */
export const REACTIONS = ["🍅", "👏", "😂", "😱", "🔥", "🤏"] as const;

export const LIMITS = {
  maxPlayers: 8,
  maxName: 24,
  minRounds: 1,
  maxRounds: 20,
  roundSeconds: 20,
  blitzSeconds: 8,
  /** Results reveal: a beat per player plus the winner fanfare, then a pause. */
  revealPerPlayerMs: 1400,
  revealBaseMs: 2500,
  betweenRoundsMs: 6000,
  /** Accept cuts that arrive this long after the deadline (network latency). */
  graceMs: 2000,
  /** Minimum gap between two reactions from the same connection. */
  reactionGapMs: 600,
  /** Minimum gap between two aim updates relayed from one connection (~12 per second). */
  aimGapMs: 80,
  /** Rooms with no activity for this long are deleted. */
  idleMs: 12 * 60 * 60 * 1000,
} as const;
