import type { Vec3 } from "./mesh.ts";
import type { CutResult, Plane } from "./slice.ts";

/**
 * In a multiplayer round everyone gets the same kind of object but their own
 * shape: the per-player seed mixes the round seed with the player's id.
 * Client and scoring server must derive it identically.
 */
export function playerSeed(roundSeed: string, userId: string): string {
  return `${roundSeed}:${userId}`;
}

/** Objects sit within this distance of the origin, cm. */
const MAX_PLANE_OFFSET = 30;

/**
 * Parses an untrusted cut. The game only allows vertical cuts (horizontal
 * normal), so the server rejects anything else rather than scoring it.
 * Returns the plane with a unit normal, or an error message.
 */
export function parseCutPlane(input: unknown): { plane: Plane } | { error: string } {
  if (typeof input !== "object" || input === null) return { error: "plane must be an object" };
  const { point, normal } = input as { point?: unknown; normal?: unknown };
  const isVec3 = (v: unknown): v is Vec3 =>
    Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  if (!isVec3(point) || !isVec3(normal)) return { error: "point and normal must be [x, y, z] numbers" };

  if (point.some((n) => Math.abs(n) > MAX_PLANE_OFFSET)) return { error: "plane point is out of range" };
  const len = Math.hypot(normal[0], normal[2]);
  if (len < 1e-6) return { error: "normal must be horizontal (vertical cut)" };
  if (Math.abs(normal[1]) > 1e-6 * Math.max(1, len)) return { error: "only vertical cuts are allowed" };

  return { plane: { point: [point[0], point[1], point[2]], normal: [normal[0] / len, 0, normal[2] / len] } };
}

/**
 * What a round asks for. Most rounds are the classic "cut it in half"; the
 * others reuse the same scoring with a twist.
 */
export type RoundRule =
  | { type: "classic" }
  /** Leave `target` of the mass on one side (either side counts). */
  | { type: "target"; target: number }
  /** Same goal, a few seconds on the clock. */
  | { type: "blitz" }
  /** The object disappears shortly after the round starts. */
  | { type: "blind" }
  /** Everyone gets the exact same object, for a direct comparison. */
  | { type: "twin" };

export function ruleTarget(rule: RoundRule): number {
  return rule.type === "target" ? rule.target : 0.5;
}

/**
 * How far a cut is from the goal, on the same 0..1 scale for every rule:
 * 2·|fraction − target| for whichever side is closer to the target. For the
 * classic 50% goal this equals |front − back| / total. A miss scores 1.
 */
export function cutError(result: CutResult, target = 0.5): number {
  const total = result.massFront + result.massBack;
  if (!(total > 0) || result.massFront === 0 || result.massBack === 0) return 1;
  const f = result.fractionFront;
  return Math.min(1, 2 * Math.min(Math.abs(f - target), Math.abs(1 - f - target)));
}

/** Seed of a player's object: their own, unless the round gives everyone the same one. */
export function objectSeed(roundSeed: string, userId: string, rule: RoundRule): string {
  return rule.type === "twin" ? `${roundSeed}:twin` : playerSeed(roundSeed, userId);
}
