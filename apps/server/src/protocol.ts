import type { CutResult, ObjectKind, Plane } from "@slice-even/core";

/**
 * Wire format between the browser and a room's Durable Object. The shapes
 * of the public state follow what the UI renders.
 */

export interface Room {
  code: string;
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
  last_cut_round: number;
  joined_at: string;
  online: boolean;
}

export interface Round {
  id: string;
  number: number;
  kind: ObjectKind;
  /** Each player's object comes from playerSeed(seed, user_id) in core. */
  seed: string;
  status: "cutting" | "scored";
  started_at: string;
  deadline: string;
  winner_id: string | null;
}

export interface Cut {
  round_id: string;
  user_id: string;
  plane: Plane;
  mass_front: number;
  mass_back: number;
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
  | { type: "ping" };

export type ServerMessage =
  | { type: "state"; state: RoomState; you: string; serverTime: number }
  | { type: "cutResult"; requestId: string; score: CutResult }
  /** A failed action; the connection stays open. */
  | { type: "error"; requestId?: string; message: string }
  /** The connection cannot continue (room missing, full, already started). */
  | { type: "fatal"; message: string }
  | { type: "pong" };

export const LIMITS = {
  maxPlayers: 8,
  maxName: 24,
  minRounds: 1,
  maxRounds: 20,
  roundSeconds: 45,
  /** Accept cuts that arrive this long after the deadline (network latency). */
  graceMs: 2000,
  /** Rooms with no activity for this long are deleted. */
  idleMs: 12 * 60 * 60 * 1000,
} as const;
