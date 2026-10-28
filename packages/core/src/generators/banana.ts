import { createRng, type Rng } from "../rng.ts";
import { createNoise3, fbm3 } from "../noise.ts";
import { bowedSpine, buildHorizontalSweep, roundTip } from "../geometry/sweep.ts";
import type { StarShapeOptions } from "../geometry/starShape.ts";
import { smoothstep } from "../math.ts";
import type { GeneratedObject } from "./types.ts";

/** Lies along X, stem at -X (s = 0), blossom tip at +X (s = 1). */
export interface BananaParams {
  length: number;
  radius: number;
  /** Curvature, cm (either sign along Z). */
  bend: number;
  /** Angular cross-section: number of faces and how pronounced they are. */
  facets: { count: number; amplitude: number; rotation: number };
  /** Where the body narrows into the stem, as a fraction of the length. */
  neck: number;
  /** Bulge of the middle relative to the ends. */
  belly: number;
  noise: { amplitude: number; frequency: number };
}

export const BANANA_DENSITY = 0.94;
export const DEFAULT_BANANA_RESOLUTION: StarShapeOptions = { rings: 96, segments: 40 };

export function sampleBananaParams(rng: Rng): BananaParams {
  return {
    length: rng.range(16, 22),
    radius: rng.range(1.5, 2.0),
    bend: rng.range(2.6, 4) * rng.pick([-1, 1]),
    facets: { count: 5, amplitude: rng.range(0.05, 0.09), rotation: rng.range(0, Math.PI) },
    neck: rng.range(0.16, 0.24),
    belly: rng.range(0.1, 0.22),
    noise: { amplitude: rng.range(0.01, 0.03), frequency: rng.range(0.3, 0.5) },
  };
}

/** Smooth radius along the banana, shared with the interior shader. */
export function bananaBaseRadius(params: BananaParams, s: number): number {
  const { length, radius, neck, belly } = params;
  // Stem: a thin stub that widens into the body.
  const stem = 0.22 + 0.78 * smoothstep(0, neck, s);
  const stemEnd = roundTip(s * length, 0.5);
  const tipEnd = roundTip((1 - s) * length, radius * 1.1);
  const swell = 1 - belly * (2 * s - 1) ** 2;
  return radius * stem * stemEnd * tipEnd * swell;
}

export function generateBanana(
  seed: string,
  resolution: StarShapeOptions = DEFAULT_BANANA_RESOLUTION,
): GeneratedObject<"banana", BananaParams> {
  const rng = createRng(`banana:${seed}`);
  const params = sampleBananaParams(rng.fork("shape"));
  const noise = createNoise3(rng.fork("noise"));
  const { facets } = params;
  const f = params.noise.frequency;

  const mesh = buildHorizontalSweep(
    {
      ...bowedSpine(params.length, params.bend),
      radius: (s, alpha, dx, dy, dz, cx, cy, cz) => {
        const base = bananaBaseRadius(params, s);
        // |cos| raised to a low power gives flat faces with soft edges.
        const facet = Math.abs(Math.cos((facets.count * (alpha + facets.rotation)) / 2)) ** 0.6;
        let r = base * (1 + facets.amplitude * (facet - 0.6));
        r *= 1 + params.noise.amplitude * fbm3(noise, (cx + dx * base) * f, (cy + dy * base) * f, (cz + dz * base) * f, 2);
        return r;
      },
    },
    resolution,
  );
  return { kind: "banana", seed, params, density: BANANA_DENSITY, mesh };
}
