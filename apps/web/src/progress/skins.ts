import { ACHIEVEMENTS, loadStats, type Stats } from "./stats.ts";

/**
 * Knife skins: purely cosmetic rewards unlocked by achievements. The choice
 * is kept in this browser, like the rest of the personal progress. What each
 * one looks like is in scene/KnifeModels.tsx.
 */
export interface KnifeSkin {
  id: string;
  name: string;
  emoji: string;
  /** Achievement that unlocks it; null = always available. */
  unlock: string | null;
  /** Blade height multiplier (the cleaver is tall). */
  height: number;
  /** A blade of light sounds like one. */
  sound?: "saber";
}

export const SKINS: KnifeSkin[] = [
  { id: "classic", name: "Clássica", emoji: "🔪", unlock: null, height: 1 },
  { id: "chef", name: "Chef", emoji: "👨‍🍳", unlock: "first_cut", height: 1.25 },
  { id: "rustic", name: "Rústica", emoji: "🪵", unlock: "cook", height: 1.15 },
  { id: "cleaver", name: "Cutelo", emoji: "🪓", unlock: "champion", height: 1.75 },
  { id: "golden", name: "Dourada", emoji: "🏆", unlock: "golden_bowl", height: 1.05 },
  { id: "neon", name: "Neon", emoji: "💡", unlock: "regular", height: 1 },
  { id: "laser", name: "Sabre laser", emoji: "⚔️", unlock: "surgeon", height: 0.8, sound: "saber" },
];

const KEY = "slice-even:knife";

export function isUnlocked(skin: KnifeSkin, stats: Stats = loadStats()): boolean {
  return skin.unlock === null || !!stats.achievements[skin.unlock];
}

export function unlockHint(skin: KnifeSkin): string {
  const a = ACHIEVEMENTS.find((x) => x.id === skin.unlock);
  return a ? `Conquista "${a.title}"` : "";
}

/** The chosen skin, or the classic one if nothing (or something locked) is saved. */
export function selectedSkin(): KnifeSkin {
  // While developing, `?knife=laser` shows any knife without having to earn it.
  if (import.meta.env.DEV) {
    const preview = SKINS.find((s) => s.id === new URLSearchParams(location.search).get("knife"));
    if (preview) return preview;
  }
  let id = "classic";
  try {
    id = localStorage.getItem(KEY) ?? id;
  } catch {
    // Private mode: classic knife.
  }
  const skin = SKINS.find((s) => s.id === id);
  return skin && isUnlocked(skin) ? skin : SKINS[0]!;
}

export function selectSkin(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Not remembered in private mode.
  }
}
