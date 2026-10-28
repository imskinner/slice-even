import {
  createRng,
  findBisectingPlane,
  OBJECT_KINDS,
  type ObjectKind,
  scoreCut,
  type CutResult,
  type GeneratedObject,
  type Plane,
} from "@slice-even/core";

export interface CutOutcome {
  plane: Plane;
  /** Plane with the same direction that would have split the mass exactly. */
  ideal: Plane;
  score: CutResult;
  /** Signed distance from the ideal plane along the cut normal, cm. */
  offsetFromIdeal: number;
}

/** Same math the scoring server will run. */
export function evaluateCut(object: GeneratedObject, plane: Plane): CutOutcome {
  const score = scoreCut(object.mesh, plane, object.density);
  const ideal = findBisectingPlane(object.mesh, plane.normal);
  const n = plane.normal;
  const len = Math.hypot(...n);
  const offsetFromIdeal =
    ((plane.point[0] - ideal.point[0]) * n[0] +
      (plane.point[1] - ideal.point[1]) * n[1] +
      (plane.point[2] - ideal.point[2]) * n[2]) /
    len;
  return { plane, ideal, score, offsetFromIdeal };
}

export interface Rating {
  label: string;
  tone: "great" | "good" | "meh" | "bad";
}

export function rateError(error: number): Rating {
  if (error < 0.005) return { label: "Perfeito!", tone: "great" };
  if (error < 0.02) return { label: "Excelente", tone: "great" };
  if (error < 0.05) return { label: "Bom corte", tone: "good" };
  if (error < 0.1) return { label: "Quase", tone: "meh" };
  return { label: "Torto", tone: "bad" };
}

const APPLE_SKINS = ["#b3261e", "#8e1b1b", "#c0392b", "#7cb342", "#9ccc3c", "#d4b62c"];

/** Cosmetic per-seed variation that does not affect the score. */
export function appearanceFor(seed: string): { skinColor: string; stemTilt: number } {
  const rng = createRng(`look:${seed}`);
  return { skinColor: rng.pick(APPLE_SKINS), stemTilt: rng.range(-0.35, 0.35) };
}

export const KIND_LABELS: Record<ObjectKind, string> = {
  apple: "Maçã",
  cucumber: "Pepino",
  bread: "Pão",
};

export type KindMode = ObjectKind | "random";

export function isKindMode(value: string | null): value is KindMode {
  return value === "random" || OBJECT_KINDS.includes(value as ObjectKind);
}

export function pickKind(mode: KindMode): ObjectKind {
  return mode === "random" ? OBJECT_KINDS[Math.floor(Math.random() * OBJECT_KINDS.length)]! : mode;
}

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}
