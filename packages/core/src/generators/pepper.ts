import { createRng, type Rng } from "../rng.ts";
import { createNoise3, fbm3 } from "../noise.ts";
import { buildStarShape, type StarShapeOptions } from "../geometry/starShape.ts";
import type { GeneratedObject } from "./types.ts";

export type PepperColor = "red" | "yellow" | "green" | "orange";

export interface PepperParams {
  radius: number;
  /** Bell peppers are a little taller than they are wide. */
  heightRatio: number;
  /** The three or four lobes that run from the shoulders to the base. */
  lobes: { count: number; amplitude: number; phase: number };
  /** How much narrower the base is than the shoulders, 0..1. */
  taper: number;
  topDimple: { depth: number; width: number };
  lopsided: { amount: number; angle: number };
  noise: { amplitude: number; frequency: number };
  /** Wall thickness as a fraction of the radius (interior shader). */
  wall: number;
  color: PepperColor;
}

/**
 * A pepper is hollow. The score treats it as a solid of one density (the
 * mesh has no cavity), so the density is that of the whole thing, air
 * included: a pepper the size of an apple weighs about half as much.
 */
export const PEPPER_DENSITY = 0.36;
export const DEFAULT_PEPPER_RESOLUTION: StarShapeOptions = { rings: 56, segments: 84 };

/** How boxy the side profile is: 2 is a sphere, higher squares the shoulders. */
export const PEPPER_BOXINESS = 3;

export function samplePepperParams(rng: Rng): PepperParams {
  return {
    radius: rng.range(3.6, 4.6),
    heightRatio: rng.range(1.05, 1.35),
    lobes: { count: rng.int(3, 4), amplitude: rng.range(0.07, 0.13), phase: rng.range(0, 2 * Math.PI) },
    taper: rng.range(0.12, 0.3),
    topDimple: { depth: rng.range(0.14, 0.22), width: rng.range(0.32, 0.45) },
    lopsided: { amount: rng.range(0.04, 0.1), angle: rng.range(0, 2 * Math.PI) },
    noise: { amplitude: rng.range(0.015, 0.03), frequency: rng.range(0.7, 1.2) },
    wall: rng.range(0.14, 0.2),
    color: rng.pick(["red", "red", "yellow", "green", "orange"] as const),
  };
}

export function generatePepper(
  seed: string,
  resolution: StarShapeOptions = DEFAULT_PEPPER_RESOLUTION,
): GeneratedObject<"pepper", PepperParams> {
  const rng = createRng(`pepper:${seed}`);
  const params = samplePepperParams(rng.fork("shape"));
  const noise = createNoise3(rng.fork("noise"));
  const { radius, lobes, topDimple, lopsided } = params;
  const f = params.noise.frequency;
  const n = PEPPER_BOXINESS;

  const mesh = buildStarShape((theta, phi, x, y, z) => {
    const s = Math.sin(theta);
    const c = Math.abs(Math.cos(theta));
    // A superellipse in profile: flat-ish top and bottom, upright sides.
    let r = (c ** n + s ** n) ** (-1 / n);
    r *= 1 + lobes.amplitude * s * Math.cos(lobes.count * phi + lobes.phase);
    r *= 1 + lopsided.amount * s * Math.cos(phi - lopsided.angle);
    r *= 1 + params.noise.amplitude * fbm3(noise, x * f, y * f, z * f, 2);
    // The stem sits in a deep dimple between the shoulders.
    r -= topDimple.depth * Math.exp(-((theta / topDimple.width) ** 2));
    return radius * r;
  }, resolution);

  // Narrower towards the base, then stretched to its height.
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const down = Math.min(1, Math.max(0, 0.5 - p[i + 1]! / (2 * radius)));
    const k = 1 - params.taper * down * down;
    p[i] = p[i]! * k;
    p[i + 2] = p[i + 2]! * k;
    p[i + 1] = p[i + 1]! * params.heightRatio;
  }
  return { kind: "pepper", seed, params, density: PEPPER_DENSITY, mesh };
}
