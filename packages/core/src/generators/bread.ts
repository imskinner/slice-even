import type { Mesh } from "../mesh.ts";
import { createRng, type Rng } from "../rng.ts";
import { createNoise3, fbm3, type Noise3 } from "../noise.ts";
import { buildStarShape, type StarShapeOptions } from "../geometry/starShape.ts";
import { smoothstep } from "../math.ts";
import type { GeneratedObject } from "./types.ts";

/**
 * A rustic loaf: a superellipsoid with a domed top and a flat base, one end
 * a bit bigger than the other, diagonal slashes across the top.
 * The loaf lies along X with its base near y = -heightBottom.
 */
export interface BreadParams {
  /** Half-length towards +X and towards -X, cm. Unequal ends move the true middle. */
  lengthPos: number;
  lengthNeg: number;
  /** Height above / depth below the origin, cm. */
  heightTop: number;
  heightBottom: number;
  /** Half-width along Z, cm. */
  width: number;
  /**
   * Vertical profile exponents: low = rounded dome, high = flat base. The
   * footprint (seen from above) has its own exponent shared by both halves,
   * so the two halves meet without a step at y = 0.
   */
  exponentTop: number;
  exponentBottom: number;
  exponentFootprint: number;
  /** Top height changes along the length: heightTop * (1 + slope * dirX). */
  slope: number;
  slashes: { count: number; angle: number; depth: number; width: number };
  noise: { amplitude: number; frequency: number };
}

/** Airy crumb: about a quarter of the density of water. */
export const BREAD_DENSITY = 0.24;

export const DEFAULT_BREAD_RESOLUTION: StarShapeOptions = { rings: 80, segments: 112 };

export function sampleBreadParams(rng: Rng): BreadParams {
  return {
    lengthPos: rng.range(7.5, 10),
    lengthNeg: rng.range(7.5, 10),
    heightTop: rng.range(3.8, 5.4),
    heightBottom: rng.range(1.2, 1.9),
    width: rng.range(4.6, 6.2),
    exponentTop: rng.range(2.2, 3),
    exponentBottom: rng.range(5, 8),
    exponentFootprint: rng.range(2.4, 3.4),
    slope: rng.range(-0.12, 0.12),
    slashes: {
      count: rng.int(3, 5),
      angle: rng.range(0.35, 0.75),
      depth: rng.range(0.35, 0.7),
      width: rng.range(0.45, 0.7),
    },
    noise: { amplitude: rng.range(0.012, 0.03), frequency: rng.range(0.25, 0.45) },
  };
}

/**
 * Smooth loaf's implicit "radius ratio" for a point: 1 on the surface (before
 * slashes and noise), < 1 inside. Homogeneous of degree 1 along each ray, so
 * the surface radius in direction d is 1 / breadShapeRatio(params, d).
 * The interior shader mirrors this to draw the crust.
 */
export function breadShapeRatio(params: BreadParams, x: number, y: number, z: number): number {
  const len = Math.hypot(x, y, z) || 1;
  const a = x > 0 ? params.lengthPos : params.lengthNeg;
  const b = y > 0 ? params.heightTop * (1 + (params.slope * x) / len) : params.heightBottom;
  const e = y > 0 ? params.exponentTop : params.exponentBottom;
  const h = params.exponentFootprint;
  const footprint = (Math.abs(x / a) ** h + Math.abs(z / params.width) ** h) ** (1 / h);
  return (footprint ** e + Math.abs(y / b) ** e) ** (1 / e);
}

export function buildBread(
  params: BreadParams,
  noise: Noise3,
  resolution: StarShapeOptions = DEFAULT_BREAD_RESOLUTION,
): Mesh {
  const { slashes } = params;
  const halfLength = (params.lengthPos + params.lengthNeg) / 2;
  const dirX = Math.sin(slashes.angle);
  const dirZ = Math.cos(slashes.angle);
  const slashHalf = (params.width * 0.85) / dirZ;
  const centers = Array.from({ length: slashes.count }, (_, k) =>
    slashes.count === 1 ? 0 : (k / (slashes.count - 1) - 0.5) * 2 * 0.62 * halfLength,
  );

  return buildStarShape((_theta, _phi, x, y, z) => {
    const r0 = 1 / breadShapeRatio(params, x, y, z);
    const px = x * r0;
    const py = y * r0;
    const pz = z * r0;

    // Slashes only cut the upper part of the dome.
    let groove = 0;
    const top = smoothstep(0.5, 0.85, py / params.heightTop);
    if (top > 0) {
      for (const cx of centers) {
        const rx = px - cx;
        const along = rx * dirX + pz * dirZ;
        const across = rx * dirZ - pz * dirX;
        const fade = smoothstep(slashHalf, slashHalf * 0.6, Math.abs(along));
        groove = Math.max(groove, fade * Math.exp(-((across / slashes.width) ** 2)));
      }
    }

    const f = params.noise.frequency;
    const lumpy = 1 + params.noise.amplitude * fbm3(noise, px * f, py * f, pz * f, 3);
    return r0 * lumpy - slashes.depth * groove * top;
  }, resolution);
}

export function generateBread(
  seed: string,
  resolution: StarShapeOptions = DEFAULT_BREAD_RESOLUTION,
): GeneratedObject<"bread", BreadParams> {
  const rng = createRng(`bread:${seed}`);
  const params = sampleBreadParams(rng.fork("shape"));
  const noise = createNoise3(rng.fork("noise"));
  return {
    kind: "bread",
    seed,
    params,
    density: BREAD_DENSITY,
    mesh: buildBread(params, noise, resolution),
  };
}
