import { createRng, type Rng } from "../rng.ts";
import { createNoise3, fbm3 } from "../noise.ts";
import { buildStarShape, type StarShapeOptions } from "../geometry/starShape.ts";
import type { GeneratedObject } from "./types.ts";

export interface OrangeParams {
  radius: number;
  heightRatio: number;
  /** Shallow button at the bottom (navel) and stem pit at the top. */
  navel: { depth: number; width: number };
  stemPit: { depth: number; width: number };
  /** One side slightly fuller, which moves the true middle. */
  lopsided: { amount: number; angle: number };
  noise: { amplitude: number; frequency: number };
  /** Interior, used by the shader: number of segments, their rotation, peel thickness (cm). */
  segments: number;
  segmentRotation: number;
  rind: number;
}

export const ORANGE_DENSITY = 0.9;
export const DEFAULT_ORANGE_RESOLUTION: StarShapeOptions = { rings: 48, segments: 64 };

export function sampleOrangeParams(rng: Rng): OrangeParams {
  return {
    radius: rng.range(3.6, 4.4),
    heightRatio: rng.range(0.88, 1.0),
    navel: { depth: rng.range(0.03, 0.08), width: rng.range(0.18, 0.3) },
    stemPit: { depth: rng.range(0.02, 0.05), width: rng.range(0.12, 0.2) },
    lopsided: { amount: rng.range(0.015, 0.05), angle: rng.range(0, 2 * Math.PI) },
    noise: { amplitude: rng.range(0.008, 0.02), frequency: rng.range(1.2, 2) },
    segments: rng.int(9, 12),
    segmentRotation: rng.range(0, Math.PI),
    rind: rng.range(0.35, 0.6),
  };
}

const gaussian = (x: number, width: number) => Math.exp(-((x / width) ** 2));

export function generateOrange(
  seed: string,
  resolution: StarShapeOptions = DEFAULT_ORANGE_RESOLUTION,
): GeneratedObject<"orange", OrangeParams> {
  const rng = createRng(`orange:${seed}`);
  const params = sampleOrangeParams(rng.fork("shape"));
  const noise = createNoise3(rng.fork("noise"));
  const { radius, heightRatio, navel, stemPit, lopsided } = params;
  const f = params.noise.frequency;

  const mesh = buildStarShape((theta, phi, x, y, z) => {
    let r = 1 + lopsided.amount * Math.sin(theta) * Math.cos(phi - lopsided.angle);
    r *= 1 + params.noise.amplitude * fbm3(noise, x * f, y * f, z * f, 3);
    r -= stemPit.depth * gaussian(theta, stemPit.width);
    r -= navel.depth * gaussian(Math.PI - theta, navel.width);
    return radius * r;
  }, resolution);

  const p = mesh.positions;
  for (let i = 1; i < p.length; i += 3) p[i] = p[i]! * heightRatio;
  return { kind: "orange", seed, params, density: ORANGE_DENSITY, mesh };
}
