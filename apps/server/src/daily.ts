import {
  createRng,
  cutError,
  generateObject,
  OBJECT_KINDS,
  parseCutPlane,
  scoreCut,
  type CutResult,
  type ObjectKind,
  type Plane,
} from "@slice-even/core";
import { LIMITS } from "./protocol.ts";
import { RoomError } from "./room.ts";

/**
 * Daily challenge: one object per UTC day, the same for everyone, one
 * attempt each, ranked worldwide. Pure logic; the Daily Durable Object stores
 * one DailyData per date.
 */

/** Challenge #1 was on this UTC day. */
const EPOCH = Date.UTC(2026, 10, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DailyPuzzle {
  date: string;
  number: number;
  kind: ObjectKind;
  seed: string;
}

export interface DailyEntry {
  playerId: string;
  token: string;
  name: string;
  plane: Plane;
  massFront: number;
  massBack: number;
  error: number;
  at: number;
}

export interface DailyData {
  date: string;
  entries: DailyEntry[];
}

export interface DailyStanding {
  name: string;
  error: number;
  you: boolean;
}

export interface DailyResult {
  score: CutResult;
  /** 1-based position among everyone who played today. */
  rank: number;
  total: number;
  /** Share of players you beat, 0..1. */
  beat: number;
}

export function dailyDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function dailyPuzzle(date: string): DailyPuzzle {
  const rng = createRng(`daily:${date}`);
  return {
    date,
    number: Math.floor((Date.parse(`${date}T00:00:00Z`) - EPOCH) / DAY_MS) + 1,
    kind: OBJECT_KINDS[Math.floor(rng.next() * OBJECT_KINDS.length)]!,
    seed: `daily:${date}`,
  };
}

/** Milliseconds until the next challenge (next UTC midnight). */
export function msUntilNextDaily(now: number): number {
  return DAY_MS - (now % DAY_MS);
}

function ranked(data: DailyData): DailyEntry[] {
  return [...data.entries].sort((a, b) => a.error - b.error || a.at - b.at);
}

export function standingOf(data: DailyData, playerId: string): DailyResult | null {
  const order = ranked(data);
  const index = order.findIndex((e) => e.playerId === playerId);
  if (index < 0) return null;
  const e = order[index]!;
  const total = order.length;
  return {
    score: {
      massFront: e.massFront,
      massBack: e.massBack,
      fractionFront: e.massFront / (e.massFront + e.massBack || 1),
      error: e.error,
    },
    rank: index + 1,
    total,
    beat: total > 1 ? (total - 1 - index) / (total - 1) : 1,
  };
}

export function leaderboard(data: DailyData, viewerId: string, top = 10): DailyStanding[] {
  return ranked(data)
    .slice(0, top)
    .map((e) => ({ name: e.name, error: e.error, you: e.playerId === viewerId }));
}

/** Scores the one attempt a player gets today. */
export function submitDaily(
  data: DailyData,
  playerId: string,
  token: string,
  rawName: string,
  planeInput: unknown,
  now: number,
): DailyResult {
  if (dailyDate(now) !== data.date) throw new RoomError("Esse desafio já acabou. Volte para o de hoje!");
  const name = rawName.trim().slice(0, LIMITS.maxName) || "Anônimo";
  if (!playerId || !token) throw new RoomError("Identidade inválida.");
  if (data.entries.some((e) => e.playerId === playerId)) throw new RoomError("Você já jogou o desafio de hoje.");
  const parsed = parseCutPlane(planeInput);
  if ("error" in parsed) throw new RoomError(`Corte inválido: ${parsed.error}`);

  const puzzle = dailyPuzzle(data.date);
  const object = generateObject(puzzle.kind, puzzle.seed);
  const raw = scoreCut(object.mesh, parsed.plane, object.density);
  data.entries.push({
    playerId,
    token,
    name,
    plane: parsed.plane,
    massFront: raw.massFront,
    massBack: raw.massBack,
    error: cutError(raw),
    at: now,
  });
  return standingOf(data, playerId)!;
}
