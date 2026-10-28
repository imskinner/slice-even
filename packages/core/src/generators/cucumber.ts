import type { Mesh } from "../mesh.ts";
import { createRng, type Rng } from "../rng.ts";
import { createNoise3, fbm3, type Noise3 } from "../noise.ts";
import { buildPoleGrid } from "../geometry/poleGrid.ts";
import type { StarShapeOptions } from "../geometry/starShape.ts";
import type { GeneratedObject } from "./types.ts";

export interface CucumberParams {
  /** End to end along X, cm. */
  length: number;
  /** Body radius at the middle, cm. */
  radius: number;
  /** How far from each end the rounded tip reaches full radius, cm. */
  capLength: number;
  /** Sideways bow of the spine at the middle, cm (along Z, either sign). */
  bend: number;
  /** Radius change from one end to the other, as a fraction (one end fatter). */
  taper: number;
  /** Shallow lengthwise ridges. */
  ridges: { count: number; amplitude: number };
  noise: { amplitude: number; frequency: number };
  /** Small bumps on the skin. */
  warts: { amplitude: number; frequency: number };
  /** Angle of the three seed chambers; cosmetic (interior shader). */
  seedRotation: number;
}

export const CUCUMBER_DENSITY = 0.96;

/** `rings` run along the length, `segments` around it. */
export const DEFAULT_CUCUMBER_RESOLUTION: StarShapeOptions = { rings: 96, segments: 48 };

export function sampleCucumberParams(rng: Rng): CucumberParams {
  const radius = rng.range(1.9, 2.6);
  return {
    length: rng.range(17, 24),
    radius,
    capLength: radius * rng.range(1.3, 2.2),
    bend: rng.range(0, 2.2) * rng.pick([-1, 1]),
    taper: rng.range(-0.25, 0.25),
    ridges: { count: rng.pick([0, 6, 7, 8]), amplitude: rng.range(0.008, 0.022) },
    noise: { amplitude: rng.range(0.02, 0.05), frequency: rng.range(0.25, 0.45) },
    warts: { amplitude: rng.range(0.02, 0.05), frequency: rng.range(1.2, 1.8) },
    seedRotation: rng.range(0, (2 * Math.PI) / 3),
  };
}

/** Spine point at parameter s. The curve is a quadratic Bézier with x linear in s. */
export function cucumberSpine(params: CucumberParams, s: number): [number, number, number] {
  return [-params.length / 2 + params.length * s, 0, 4 * params.bend * s * (1 - s)];
}

/**
 * Smooth radius along the spine without ridges, warts or noise: rounded tips
 * plus taper. The interior shader uses the same formula to find the skin.
 */
export function cucumberBaseRadius(params: CucumberParams, s: number): number {
  const u = Math.min(s, 1 - s) * params.length;
  const tip = u < params.capLength ? Math.sqrt(Math.max(0, 1 - (1 - u / params.capLength) ** 2)) : 1;
  return params.radius * tip * (1 + params.taper * (s - 0.5));
}

export function buildCucumber(
  params: CucumberParams,
  noise: Noise3,
  { rings, segments }: StarShapeOptions = DEFAULT_CUCUMBER_RESOLUTION,
): Mesh {
  const { length, bend, ridges } = params;

  // Swept tube along the spine, closed by a pole at each tip.
  return buildPoleGrid(rings, segments, (i, j, out, o) => {
    // Cosine spacing packs rings near the tips, where the radius changes fastest.
    const s = (1 - Math.cos((Math.PI * i) / rings)) / 2;
    const [cx, cy, cz] = cucumberSpine(params, s);
    if (i === 0 || i === rings) {
      out[o] = cx;
      out[o + 1] = cy;
      out[o + 2] = cz;
      return;
    }

    // Frame: T along the spine, B = +Y, N = B × T. With segments turning from
    // N towards B and rings running along T, segment × ring = B × T = N: outwards.
    const tx = length;
    const tz = 4 * bend * (1 - 2 * s);
    const tl = Math.hypot(tx, tz);
    const nx = tz / tl;
    const nz = -tx / tl;

    const alpha = (2 * Math.PI * j) / segments;
    const ca = Math.cos(alpha);
    const sa = Math.sin(alpha);
    const dx = ca * nx;
    const dy = sa;
    const dz = ca * nz;

    const base = cucumberBaseRadius(params, s);
    // Sample noise on the smooth surface so it does not depend on itself.
    const px = cx + dx * base;
    const py = cy + dy * base;
    const pz = cz + dz * base;
    const f = params.noise.frequency;
    const w = params.warts.frequency;

    let r = base;
    if (ridges.count > 0) r *= 1 + ridges.amplitude * Math.cos(ridges.count * alpha);
    r *= 1 + params.noise.amplitude * fbm3(noise, px * f, py * f, pz * f, 2);
    r *= 1 + params.warts.amplitude * Math.max(0, noise(px * w + 31, py * w, pz * w) - 0.4);

    out[o] = cx + dx * r;
    out[o + 1] = cy + dy * r;
    out[o + 2] = cz + dz * r;
  });
}

export function generateCucumber(
  seed: string,
  resolution: StarShapeOptions = DEFAULT_CUCUMBER_RESOLUTION,
): GeneratedObject<"cucumber", CucumberParams> {
  const rng = createRng(`cucumber:${seed}`);
  const params = sampleCucumberParams(rng.fork("shape"));
  const noise = createNoise3(rng.fork("noise"));
  return {
    kind: "cucumber",
    seed,
    params,
    density: CUCUMBER_DENSITY,
    mesh: buildCucumber(params, noise, resolution),
  };
}
