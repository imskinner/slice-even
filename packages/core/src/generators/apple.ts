import type { Mesh } from "../mesh.ts";
import { createRng, type Rng } from "../rng.ts";
import { createNoise3, fbm3, type Noise3 } from "../noise.ts";
import { buildStarShape, type StarShapeOptions } from "../geometry/starShape.ts";
import type { GeneratedObject } from "./types.ts";

export interface AppleParams {
  /** Equatorial radius before deformation, cm. */
  radius: number;
  /** Height / width. Real apples are a bit flatter than a sphere. */
  heightRatio: number;
  /** How much wider the upper "shoulder" is than the equator. */
  shoulder: number;
  /** How much the lower half narrows towards the calyx. */
  taper: number;
  /** Stem cavity, as fraction of radius / angular width in radians. */
  topDimple: { depth: number; width: number };
  /** Calyx cavity at the bottom. */
  bottomDimple: { depth: number; width: number };
  /** Bumps around the bottom (Red Delicious style). */
  lobes: { count: number; amplitude: number; phase: number };
  /**
   * One cheek fuller than the other, towards azimuth `angle`. This is what
   * moves the true middle off the visual center, which makes the game hard.
   */
  lopsided: { amount: number; angle: number };
  /** Low-frequency lumpiness. */
  noise: { amplitude: number; frequency: number; octaves: number };
  /** Horizontal shear per cm of height, so the apple leans and its mass center drifts off-axis. */
  lean: { x: number; z: number };
  /** Slight non-uniform squash in the horizontal plane. */
  squash: { x: number; z: number };
  /** Seed core, drawn by the interior shader. Cosmetic for now. */
  core: AppleCore;
}

export interface AppleCore {
  /** Radius / half-height of the core around the (leaning) vertical axis, cm. */
  radius: number;
  height: number;
  /** Core center height relative to the origin, cm (before heightRatio). */
  offsetY: number;
  /** Rotation of the five-pointed carpel star. */
  rotation: number;
  /** Seed distance from the axis, cm. */
  seedDistance: number;
  /** Which of the five chambers hold a seed. */
  seeds: boolean[];
}

function sampleAppleCore(rng: Rng): AppleCore {
  const radius = rng.range(1.0, 1.4);
  return {
    radius,
    height: rng.range(1.5, 2.1),
    offsetY: rng.range(-0.3, 0.3),
    rotation: rng.range(0, (2 * Math.PI) / 5),
    seedDistance: radius * rng.range(0.5, 0.62),
    seeds: Array.from({ length: 5 }, () => rng.next() < 0.75),
  };
}

/** Apple flesh is ~0.8 g/cm³ (which is why apples float). */
export const APPLE_DENSITY = 0.82;

export const DEFAULT_APPLE_RESOLUTION: StarShapeOptions = { rings: 48, segments: 64 };

export function sampleAppleParams(rng: Rng): AppleParams {
  return {
    radius: rng.range(3.6, 4.6),
    heightRatio: rng.range(0.82, 0.98),
    shoulder: rng.range(0.03, 0.1),
    taper: rng.range(0.05, 0.16),
    topDimple: { depth: rng.range(0.14, 0.28), width: rng.range(0.26, 0.4) },
    bottomDimple: { depth: rng.range(0.06, 0.16), width: rng.range(0.22, 0.34) },
    lobes: {
      count: rng.pick([0, 5, 5, 5]),
      amplitude: rng.range(0.01, 0.045),
      phase: rng.range(0, 2 * Math.PI),
    },
    lopsided: { amount: rng.range(0.02, 0.08), angle: rng.range(0, 2 * Math.PI) },
    noise: { amplitude: rng.range(0.015, 0.045), frequency: rng.range(0.9, 1.6), octaves: 2 },
    lean: { x: rng.range(-0.05, 0.05), z: rng.range(-0.05, 0.05) },
    squash: { x: rng.range(0.96, 1.04), z: rng.range(0.96, 1.04) },
    // Own stream, so interior tweaks never change the shape.
    core: sampleAppleCore(rng.fork("core")),
  };
}

const gaussian = (x: number, width: number) => Math.exp(-((x / width) ** 2));

export function buildApple(
  params: AppleParams,
  noise: Noise3,
  resolution: StarShapeOptions = DEFAULT_APPLE_RESOLUTION,
): Mesh {
  const { radius, shoulder, taper, topDimple, bottomDimple, lobes } = params;

  const mesh = buildStarShape((theta, phi, x, y, z) => {
    // Shoulder: y(1 - y²) peaks above the equator, scaled so the peak is ~1.
    let r = 1 + shoulder * 2.6 * y * (1 - y * y);
    const below = Math.max(0, -y);
    r *= 1 - taper * below * below;

    if (lobes.count > 0) {
      // Fade the lobes out at the bottom pole and above the equator.
      const weight = (1 - y * y) * Math.min(1, Math.max(0, 0.5 - y));
      r *= 1 + lobes.amplitude * weight * Math.cos(lobes.count * phi + lobes.phase);
    }

    // sinθ·cos(φ - angle): the horizontal component towards the full cheek.
    r *= 1 + params.lopsided.amount * Math.sin(theta) * Math.cos(phi - params.lopsided.angle);

    r *= 1 + params.noise.amplitude * fbm3(
      noise,
      x * params.noise.frequency,
      y * params.noise.frequency,
      z * params.noise.frequency,
      params.noise.octaves,
    );

    r -= topDimple.depth * gaussian(theta, topDimple.width);
    r -= bottomDimple.depth * gaussian(Math.PI - theta, bottomDimple.width);
    return radius * r;
  }, resolution);

  // Linear transforms keep the mesh closed and non-self-intersecting.
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const y = p[i + 1]! * params.heightRatio;
    p[i] = p[i]! * params.squash.x + y * params.lean.x;
    p[i + 1] = y;
    p[i + 2] = p[i + 2]! * params.squash.z + y * params.lean.z;
  }
  return mesh;
}

export function generateApple(
  seed: string,
  resolution: StarShapeOptions = DEFAULT_APPLE_RESOLUTION,
): GeneratedObject<"apple", AppleParams> {
  const rng = createRng(`apple:${seed}`);
  const params = sampleAppleParams(rng.fork("shape"));
  const noise = createNoise3(rng.fork("noise"));
  return {
    kind: "apple",
    seed,
    params,
    density: APPLE_DENSITY,
    mesh: buildApple(params, noise, resolution),
  };
}
