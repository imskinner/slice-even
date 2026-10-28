import { createRng, type Rng } from "../rng.ts";
import { createNoise3, fbm3 } from "../noise.ts";
import { bowedSpine, buildHorizontalSweep, roundTip } from "../geometry/sweep.ts";
import type { StarShapeOptions } from "../geometry/starShape.ts";
import type { GeneratedObject } from "./types.ts";

/** Lies along X: crown (leaves) at -X (s = 0), root tip at +X (s = 1). */
export interface CarrotParams {
  length: number;
  /** Radius at the shoulder, cm. */
  radius: number;
  bend: number;
  /** Profile exponent: higher tapers faster near the crown. */
  taper: number;
  /** Horizontal growth rings on the skin. */
  rings: { amplitude: number; frequency: number };
  noise: { amplitude: number; frequency: number };
  /** Inner core radius as a fraction of the outer radius (interior shader). */
  core: number;
}

export const CARROT_DENSITY = 1.0;
export const DEFAULT_CARROT_RESOLUTION: StarShapeOptions = { rings: 96, segments: 36 };

export function sampleCarrotParams(rng: Rng): CarrotParams {
  return {
    length: rng.range(13, 19),
    radius: rng.range(1.4, 2.0),
    bend: rng.range(-1, 1),
    taper: rng.range(0.7, 1.05),
    rings: { amplitude: rng.range(0.02, 0.05), frequency: rng.range(1.2, 2.0) },
    noise: { amplitude: rng.range(0.02, 0.05), frequency: rng.range(0.4, 0.7) },
    core: rng.range(0.4, 0.55),
  };
}

/** Smooth radius along the carrot, shared with the interior shader. */
export function carrotBaseRadius(params: CarrotParams, s: number): number {
  const crown = roundTip(s * params.length, params.radius * 0.5);
  return params.radius * crown * (1 - s) ** params.taper;
}

export function generateCarrot(
  seed: string,
  resolution: StarShapeOptions = DEFAULT_CARROT_RESOLUTION,
): GeneratedObject<"carrot", CarrotParams> {
  const rng = createRng(`carrot:${seed}`);
  const params = sampleCarrotParams(rng.fork("shape"));
  const noise = createNoise3(rng.fork("noise"));
  const f = params.noise.frequency;
  const rf = params.rings.frequency;

  const mesh = buildHorizontalSweep(
    {
      ...bowedSpine(params.length, params.bend),
      radius: (s, _alpha, dx, dy, dz, cx, cy, cz) => {
        const base = carrotBaseRadius(params, s);
        const px = cx + dx * base;
        const py = cy + dy * base;
        const pz = cz + dz * base;
        // Rings: noise along the length only, so grooves wrap all the way around.
        let r = base * (1 - params.rings.amplitude * Math.max(0, noise(cx * rf, 5.3, 1.7)));
        r *= 1 + params.noise.amplitude * fbm3(noise, px * f, py * f, pz * f, 2);
        return r;
      },
    },
    resolution,
  );
  return { kind: "carrot", seed, params, density: CARROT_DENSITY, mesh };
}
