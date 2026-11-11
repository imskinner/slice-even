import type { Mesh, Vec3 } from "./mesh.ts";
import { sliceVolumes, type CutResult, type Plane } from "./slice.ts";

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
  | { type: "twin" }
  /**
   * Cut off a piece of a given weight. The player is told what the object
   * weighs and how many grams to cut: `share` of it, rounded to 5 g.
   */
  | { type: "grams"; share: number }
  /** The object turns on the board while you aim (the client's business: the cut arrives in the object's own frame). */
  | { type: "spin" }
  /** Two parallel cuts, three equal pieces. */
  | { type: "thirds" };

/** The weight a "grams" round asks for, for an object of `totalMass` grams. */
export function gramsGoal(share: number, totalMass: number): number {
  return Math.max(5, Math.round((share * totalMass) / 5) * 5);
}

/**
 * The share of the mass one side of the cut should hold. "grams" rounds
 * depend on the object: pass its mass (without it, the unrounded share).
 */
export function ruleTarget(rule: RoundRule, totalMass?: number): number {
  if (rule.type === "target") return rule.target;
  if (rule.type === "grams") {
    if (!totalMass) return rule.share;
    return Math.min(0.5, gramsGoal(rule.share, totalMass) / totalMass);
  }
  return 0.5;
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

/**
 * Precision stars for a cut, by its error: three under 2%, two under 5%,
 * one under 10%. In a game every star is worth the round's number in
 * points, so everybody scores by how well they cut, not only the podium.
 */
export function precisionStars(error: number): 0 | 1 | 2 | 3 {
  return error < 0.02 ? 3 : error < 0.05 ? 2 : error < 0.1 ? 1 : 0;
}

/** How parallel the two cuts of a "thirds" round must be (cosine of the angle between them). */
const PARALLEL = Math.cos((3 * Math.PI) / 180);

/**
 * Scores a "thirds" round: two parallel cuts, three pieces. `massBack` is
 * the piece behind both cuts, `massFront` the one in front of both (along
 * the first cut's normal) and `massMid` the slice between them. The error
 * is twice the worst piece's distance from a third of the total, the same
 * scale as a single cut's (a piece off by 1% of the object is a 2% error).
 * A cut that misses, or two cuts in the same place, score 1. Returns null
 * if the cuts are not parallel: that is not a valid answer at all.
 */
export function scoreThirds(mesh: Mesh, first: Plane, second: Plane, density: number): CutResult | null {
  const len = Math.hypot(...first.normal);
  const n: Vec3 = [first.normal[0] / len, first.normal[1] / len, first.normal[2] / len];
  const len2 = Math.hypot(...second.normal);
  const cos = (n[0] * second.normal[0] + n[1] * second.normal[1] + n[2] * second.normal[2]) / len2;
  if (Math.abs(cos) < PARALLEL) return null;

  const offset = (p: Plane) => p.point[0] * n[0] + p.point[1] * n[1] + p.point[2] * n[2];
  const [lo, hi] = [offset(first), offset(second)].sort((a, b) => a - b) as [number, number];
  const at = (d: number): Plane => ({ point: [n[0] * d, n[1] * d, n[2] * d], normal: n });
  const low = sliceVolumes(mesh, at(lo));
  const high = sliceVolumes(mesh, at(hi));
  const total = low.front + low.back;
  const massBack = Math.max(0, low.back) * density;
  const massFront = Math.max(0, high.front) * density;
  const massMid = Math.max(0, total - low.back - high.front) * density;
  const mass = massBack + massMid + massFront;
  const pieces = [massBack, massMid, massFront];
  const missed = !(mass > 0) || pieces.some((m) => m <= mass * 1e-6);
  return {
    massFront,
    massBack,
    massMid,
    fractionFront: mass > 0 ? massFront / mass : 0,
    error: missed ? 1 : Math.min(1, 2 * Math.max(...pieces.map((m) => Math.abs(m / mass - 1 / 3)))),
  };
}
