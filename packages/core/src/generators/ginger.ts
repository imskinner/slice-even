import { createRng, type Rng } from "../rng.ts";
import { createNoise3, fbm3 } from "../noise.ts";
import { buildStarShape, type StarShapeOptions } from "../geometry/starShape.ts";
import type { GeneratedObject } from "./types.ts";

export interface GingerParams {
  /**
   * The knobs: blobs that melt into each other. The first sits on the
   * origin; the rest form a crooked chain along X with fingers branching off.
   */
  knobs: { center: [number, number, number]; radius: number }[];
  /** Rhizomes are flatter than they are wide: Y scale. */
  flatten: number;
  noise: { amplitude: number; frequency: number };
}

export const GINGER_DENSITY = 1.05;
export const DEFAULT_GINGER_RESOLUTION: StarShapeOptions = { rings: 56, segments: 88 };

export function sampleGingerParams(rng: Rng): GingerParams {
  const knobs: GingerParams["knobs"] = [{ center: [0, 0, 0], radius: rng.range(1.7, 2.1) }];
  /** A new knob stuck onto `parent`, overlapping it enough to fuse. */
  const grow = (parent: number, direction: [number, number, number], radius: number) => {
    const from = knobs[parent]!;
    const reach = (from.radius + radius) * rng.range(0.72, 0.86);
    const length = Math.hypot(...direction);
    knobs.push({
      center: [
        from.center[0] + (direction[0] / length) * reach,
        from.center[1] + (direction[1] / length) * reach,
        from.center[2] + (direction[2] / length) * reach,
      ],
      radius,
    });
    return knobs.length - 1;
  };

  // The body: a crooked chain to both sides of the first knob.
  let tip = 0;
  for (let i = rng.int(1, 2); i > 0; i--) tip = grow(tip, [1, rng.range(-0.1, 0.15), rng.range(-0.45, 0.45)], rng.range(1.5, 2.0));
  tip = 0;
  for (let i = rng.int(1, 2); i > 0; i--) tip = grow(tip, [-1, rng.range(-0.1, 0.15), rng.range(-0.45, 0.45)], rng.range(1.4, 1.9));
  // Fingers: off to the sides, some with a second joint.
  const body = knobs.length;
  for (let i = rng.int(2, 4); i > 0; i--) {
    const side = rng.next() < 0.5 ? -1 : 1;
    const finger = grow(rng.int(0, body - 1), [rng.range(-0.6, 0.6), rng.range(-0.05, 0.3), side], rng.range(1.0, 1.45));
    if (rng.next() < 0.5) grow(finger, [rng.range(-0.7, 0.7), rng.range(-0.05, 0.25), side], rng.range(0.8, 1.1));
  }
  return { knobs, flatten: rng.range(0.72, 0.86), noise: { amplitude: rng.range(0.02, 0.04), frequency: rng.range(0.8, 1.3) } };
}

/** Sum of the knobs' fields: 1 on the surface of a lone knob, more inside. */
function field(knobs: GingerParams["knobs"], x: number, y: number, z: number): number {
  let sum = 0;
  for (const k of knobs) {
    const d2 = (x - k.center[0]) ** 2 + (y - k.center[1]) ** 2 + (z - k.center[2]) ** 2;
    sum += Math.exp(-2.2 * (d2 / (k.radius * k.radius) - 1));
  }
  return sum;
}

/**
 * A knobby rhizome: the most irregular thing on the board. The surface is
 * where the knobs' fields add up to 1; seen from the origin (inside the
 * first knob) each direction keeps its furthest crossing, which keeps the
 * mesh a valid star shape and fills in the undercuts between fingers.
 */
export function generateGinger(
  seed: string,
  resolution: StarShapeOptions = DEFAULT_GINGER_RESOLUTION,
): GeneratedObject<"ginger", GingerParams> {
  const rng = createRng(`ginger:${seed}`);
  const params = sampleGingerParams(rng.fork("shape"));
  const noise = createNoise3(rng.fork("noise"));
  const { knobs } = params;
  const f = params.noise.frequency;
  const reach = Math.max(...knobs.map((k) => Math.hypot(...k.center) + 1.7 * k.radius));
  // Coarser than the thinnest finger (1.6 cm across), so none is stepped over.
  const STEP = 0.5;

  const mesh = buildStarShape((_theta, _phi, x, y, z) => {
    // Walk in from outside until the field says "inside", then home in.
    let outside = reach;
    while (outside > STEP && field(knobs, x * (outside - STEP), y * (outside - STEP), z * (outside - STEP)) < 1) outside -= STEP;
    let inside = Math.max(0, outside - STEP);
    for (let i = 0; i < 12; i++) {
      const mid = (inside + outside) / 2;
      if (field(knobs, x * mid, y * mid, z * mid) >= 1) inside = mid;
      else outside = mid;
    }
    return inside * (1 + params.noise.amplitude * fbm3(noise, x * f, y * f, z * f, 3));
  }, resolution);

  const p = mesh.positions;
  for (let i = 1; i < p.length; i += 3) p[i] = p[i]! * params.flatten;
  return { kind: "ginger", seed, params, density: GINGER_DENSITY, mesh };
}
