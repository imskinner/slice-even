import { OBJECT_KINDS, type ObjectKind, type RoundRule } from "@slice-even/core";

/**
 * Personal records and achievements, kept in this browser. Nothing here is
 * competitive (the server owns rankings); it is the "reason to come back"
 * layer, so losing it in a private window is acceptable.
 */

const KEY = "slice-even:stats";

export interface Stats {
  cuts: number;
  /** Cuts under 0.5% error. */
  perfects: number;
  /** Best error per kind, any mode. */
  best: Partial<Record<ObjectKind, number>>;
  /** Consecutive cuts under 2%, any mode. */
  steadyStreak: number;
  roundsWon: number;
  gamesWon: number;
  /** Achievement id -> when it was unlocked (ms). */
  achievements: Record<string, number>;
}

export interface Achievement {
  id: string;
  emoji: string;
  title: string;
  description: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_cut", emoji: "🔪", title: "Primeiro corte", description: "Corte qualquer coisa." },
  { id: "perfect", emoji: "✨", title: "Perfeito!", description: "Erre menos de 0,5%." },
  { id: "surgeon", emoji: "🩺", title: "Cirurgião", description: "Erre menos de 0,1%." },
  { id: "steady", emoji: "🎯", title: "Mão firme", description: "Três cortes seguidos abaixo de 2%." },
  { id: "golden_bowl", emoji: "🏆", title: "Fruteira de ouro", description: "Abaixo de 1% em todos os itens." },
  { id: "bullseye", emoji: "🎯", title: "Na mosca", description: "Abaixo de 1% numa rodada de alvo." },
  { id: "blitz", emoji: "⚡", title: "Relâmpago", description: "Abaixo de 2% numa rodada relâmpago." },
  { id: "xray", emoji: "🙈", title: "Visão de raio-X", description: "Abaixo de 2% numa rodada às cegas." },
  { id: "round_win", emoji: "🥇", title: "Primeira vitória", description: "Vença uma rodada no multiplayer." },
  { id: "champion", emoji: "👑", title: "Campeão", description: "Vença uma partida no multiplayer." },
  { id: "regular", emoji: "🗓️", title: "Freguês", description: "Jogue o desafio do dia 7 dias seguidos." },
  { id: "cook", emoji: "👨‍🍳", title: "Cozinheiro", description: "Faça 100 cortes." },
];

/** Under this error a kind counts as "golden" in the collection. */
export const GOLDEN_ERROR = 0.01;

function empty(): Stats {
  return { cuts: 0, perfects: 0, best: {}, steadyStreak: 0, roundsWon: 0, gamesWon: 0, achievements: {} };
}

export function loadStats(): Stats {
  try {
    return { ...empty(), ...(JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Stats> | null) };
  } catch {
    return empty();
  }
}

function save(stats: Stats) {
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // Private mode: progress lasts for this visit only.
  }
}

export const ACHIEVEMENT_EVENT = "slice-even:achievement";

/** Marks achievements and tells the toast about the new ones. */
function unlock(stats: Stats, ids: string[]): Achievement[] {
  const fresh = ACHIEVEMENTS.filter((a) => ids.includes(a.id) && !stats.achievements[a.id]);
  for (const a of fresh) {
    stats.achievements[a.id] = Date.now();
    window.dispatchEvent(new CustomEvent(ACHIEVEMENT_EVENT, { detail: a }));
  }
  return fresh;
}

export function goldenKinds(stats: Stats): ObjectKind[] {
  return OBJECT_KINDS.filter((k) => (stats.best[k] ?? 1) < GOLDEN_ERROR);
}

export interface CutRecord {
  kind: ObjectKind;
  error: number;
  rule?: RoundRule;
}

/** Records a cut. Returns whether it beat your previous best for that kind. */
export function recordCut({ kind, error, rule }: CutRecord): { newBest: boolean } {
  const stats = loadStats();
  const previous = stats.best[kind];
  const newBest = previous === undefined || error < previous;
  if (newBest) stats.best[kind] = error;
  stats.cuts += 1;
  if (error < 0.005) stats.perfects += 1;
  stats.steadyStreak = error < 0.02 ? stats.steadyStreak + 1 : 0;

  const ids = ["first_cut"];
  if (error < 0.005) ids.push("perfect");
  if (error < 0.001) ids.push("surgeon");
  if (stats.steadyStreak >= 3) ids.push("steady");
  if (goldenKinds(stats).length === OBJECT_KINDS.length) ids.push("golden_bowl");
  if (rule?.type === "target" && error < 0.01) ids.push("bullseye");
  if (rule?.type === "blitz" && error < 0.02) ids.push("blitz");
  if (rule?.type === "blind" && error < 0.02) ids.push("xray");
  if (stats.cuts >= 100) ids.push("cook");
  unlock(stats, ids);
  save(stats);
  return { newBest: newBest && previous !== undefined };
}

export function recordRoundWin() {
  const stats = loadStats();
  stats.roundsWon += 1;
  unlock(stats, ["round_win"]);
  save(stats);
}

export function recordGameWin() {
  const stats = loadStats();
  stats.gamesWon += 1;
  unlock(stats, ["champion"]);
  save(stats);
}

export function recordDailyStreak(days: number) {
  if (days < 7) return;
  const stats = loadStats();
  unlock(stats, ["regular"]);
  save(stats);
}
