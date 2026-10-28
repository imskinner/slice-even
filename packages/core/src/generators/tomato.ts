import { createRng, type Rng } from "../rng.ts";
import { createNoise3, fbm3 } from "../noise.ts";
import { buildStarShape, type StarShapeOptions } from "../geometry/starShape.ts";
import type { GeneratedObject } from "./types.ts";

export interface TomatoParams {
  radius: number;
  /** Tomatoes are flatter than they are wide. */
  heightRatio: number;
  /** Bulges around the equator, one per seed chamber. */
  lobes: { count: number; amplitude: number; phase: number };
  topDimple: { depth: number; width: number };
  lopsided: { amount: number; angle: number };
  noise: { amplitude: number; frequency: number };
  /** Outer wall thickness, cm (interior shader). */
  wall: number;
}

export const TOMATO_DENSITY = 0.96;
export const DEFAULT_TOMATO_RESOLUTION: StarShapeOptions = { rings: 48, segments: 72 };

export function sampleTomatoParams(rng: Rng): TomatoParams {
  return {
    radius: rng.range(3.0, 4.2),
    heightRatio: rng.range(0.72, 0.9),
    lobes: { count: rng.int(5, 7), amplitude: rng.range(0.015, 0.04), phase: rng.range(0, 2 * Math.PI) },
    topDimple: { depth: rng.range(0.06, 0.12), width: rng.range(0.3, 0.45) },
    lopsided: { amount: rng.range(0.02, 0.06), angle: rng.range(0, 2 * Math.PI) },
    noise: { amplitude: rng.range(0.01, 0.025), frequency: rng.range(0.9, 1.5) },
    wall: rng.range(0.45, 0.7),
  };
}

export function generateTomato(
  seed: string,
  resolution: StarShapeOptions = DEFAULT_TOMATO_RESOLUTION,
): GeneratedObject<"tomato", TomatoParams> {
  const rng = createRng(`tomato:${seed}`);
  const params = sampleTomatoParams(rng.fork("shape"));
  const noise = createNoise3(rng.fork("noise"));
  const { radius, lobes, topDimple, lopsided } = params;
  const f = params.noise.frequency;

  const mesh = buildStarShape((theta, phi, x, y, z) => {
    const s = Math.sin(theta);
    // Lobes are strongest around the shoulders and fade at both poles.
    let r = 1 + lobes.amplitude * s * s * Math.cos(lobes.count * phi + lobes.phase);
    r *= 1 + lopsided.amount * s * Math.cos(phi - lopsided.angle);
    r *= 1 + params.noise.amplitude * fbm3(noise, x * f, y * f, z * f, 2);
    r -= topDimple.depth * Math.exp(-((theta / topDimple.width) ** 2));
    return radius * r;
  }, resolution);

  const p = mesh.positions;
  for (let i = 1; i < p.length; i += 3) p[i] = p[i]! * params.heightRatio;
  return { kind: "tomato", seed, params, density: TOMATO_DENSITY, mesh };
}
