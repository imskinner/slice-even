import { createRng, type Rng } from "../rng.ts";
import { createNoise3, fbm3 } from "../noise.ts";
import { bowedSpine, buildHorizontalSweep, roundTip } from "../geometry/sweep.ts";
import type { StarShapeOptions } from "../geometry/starShape.ts";
import type { GeneratedObject } from "./types.ts";

/** Lies along X: stem end at -X (s = 0), the fat blossom end at +X (s = 1). */
export interface EggplantParams {
  length: number;
  /** Radius at the fattest point, cm. */
  radius: number;
  /** Radius at the stem end, as a fraction of `radius`. */
  neck: number;
  /** Where along the length it is fattest, 0..1. */
  peak: number;
  bend: number;
  noise: { amplitude: number; frequency: number };
}

/** Spongy flesh: lighter than water by a good margin. */
export const EGGPLANT_DENSITY = 0.62;
export const DEFAULT_EGGPLANT_RESOLUTION: StarShapeOptions = { rings: 96, segments: 48 };

export function sampleEggplantParams(rng: Rng): EggplantParams {
  return {
    length: rng.range(15, 21),
    radius: rng.range(3.2, 4.3),
    neck: rng.range(0.38, 0.5),
    peak: rng.range(0.62, 0.74),
    bend: rng.range(-2.2, 2.2),
    noise: { amplitude: rng.range(0.015, 0.035), frequency: rng.range(0.25, 0.45) },
  };
}

const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/**
 * Smooth radius along the eggplant, shared with the interior shader: a
 * narrow neck that swells to the fattest point and stays fat to a round end.
 * All the weight is at one end, so the middle of its length is nowhere near
 * the middle of its mass.
 */
export function eggplantBaseRadius(params: EggplantParams, s: number): number {
  const swell = params.neck + (1 - params.neck) * smoothstep(s / params.peak);
  const stemTip = roundTip(s * params.length, params.radius * params.neck * 0.9);
  const blossomTip = roundTip((1 - s) * params.length, params.radius);
  return params.radius * swell * stemTip * blossomTip;
}

export function generateEggplant(
  seed: string,
  resolution: StarShapeOptions = DEFAULT_EGGPLANT_RESOLUTION,
): GeneratedObject<"eggplant", EggplantParams> {
  const rng = createRng(`eggplant:${seed}`);
  const params = sampleEggplantParams(rng.fork("shape"));
  const noise = createNoise3(rng.fork("noise"));
  const f = params.noise.frequency;

  const mesh = buildHorizontalSweep(
    {
      ...bowedSpine(params.length, params.bend),
      radius: (s, _alpha, dx, dy, dz, cx, cy, cz) => {
        const base = eggplantBaseRadius(params, s);
        const px = cx + dx * base;
        const py = cy + dy * base;
        const pz = cz + dz * base;
        return base * (1 + params.noise.amplitude * fbm3(noise, px * f, py * f, pz * f, 2));
      },
    },
    resolution,
  );
  return { kind: "eggplant", seed, params, density: EGGPLANT_DENSITY, mesh };
}
