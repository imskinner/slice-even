import { ACHIEVEMENTS, loadStats, type Stats } from "./stats.ts";

/**
 * Knife skins: purely cosmetic rewards unlocked by achievements. The choice
 * is kept in this browser, like the rest of the personal progress.
 */
export interface KnifeSkin {
  id: string;
  name: string;
  emoji: string;
  /** Achievement that unlocks it; null = always available. */
  unlock: string | null;
  blade: { color: string; metalness: number; roughness: number; emissive?: string };
  handle: { color: string; metalness?: number };
  /** Blade height multiplier (the cleaver is tall). */
  height: number;
}

export const SKINS: KnifeSkin[] = [
  { id: "classic", name: "Clássica", emoji: "🔪", unlock: null, blade: { color: "#e6eaee", metalness: 0.25, roughness: 0.25 }, handle: { color: "#3b2a20" }, height: 1 },
  { id: "chef", name: "Chef", emoji: "👨‍🍳", unlock: "first_cut", blade: { color: "#d6dde3", metalness: 0.5, roughness: 0.18 }, handle: { color: "#111518" }, height: 1.2 },
  { id: "rustic", name: "Rústica", emoji: "🪵", unlock: "cook", blade: { color: "#cfc6b8", metalness: 0.3, roughness: 0.45 }, handle: { color: "#a5713f" }, height: 1 },
  { id: "cleaver", name: "Cutelo", emoji: "🪓", unlock: "champion", blade: { color: "#b9c2c8", metalness: 0.45, roughness: 0.3 }, handle: { color: "#2b2b2b" }, height: 1.7 },
  { id: "golden", name: "Dourada", emoji: "🏆", unlock: "golden_bowl", blade: { color: "#f5c542", metalness: 0.7, roughness: 0.2 }, handle: { color: "#7a4a12", metalness: 0.3 }, height: 1.1 },
  { id: "neon", name: "Neon", emoji: "💡", unlock: "regular", blade: { color: "#5ff3ff", metalness: 0.1, roughness: 0.3, emissive: "#16c8e0" }, handle: { color: "#1b1b2e" }, height: 1 },
  { id: "laser", name: "Laser", emoji: "🔴", unlock: "surgeon", blade: { color: "#ff4d5e", metalness: 0, roughness: 0.4, emissive: "#ff1f3a" }, handle: { color: "#202020", metalness: 0.6 }, height: 0.8 },
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
