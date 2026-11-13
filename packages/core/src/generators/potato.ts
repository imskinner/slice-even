import { createRng, type Rng } from "../rng.ts";
import { createNoise3, fbm3 } from "../noise.ts";
import { buildStarShape, type StarShapeOptions } from "../geometry/starShape.ts";
import type { GeneratedObject } from "./types.ts";

export interface PotatoParams {
  /** Half-extents along X (the long way), Y and Z, cm. */
  radii: [number, number, number];
  /** Lumps and dents: each pushes the surface out (or in) around one direction. */
  bulges: { direction: [number, number, number]; size: number; width: number }[];
  noise: { amplitude: number; frequency: number };
}

export const POTATO_DENSITY = 1.08;
export const DEFAULT_POTATO_RESOLUTION: StarShapeOptions = { rings: 48, segments: 72 };

function randomDirection(rng: Rng): [number, number, number] {
  const y = rng.range(-1, 1);
  const phi = rng.range(0, 2 * Math.PI);
  const s = Math.sqrt(1 - y * y);
  return [s * Math.cos(phi), y, s * Math.sin(phi)];
}

export function samplePotatoParams(rng: Rng): PotatoParams {
  const long = rng.range(4.4, 5.8);
  return {
    radii: [long, long * rng.range(0.55, 0.68), long * rng.range(0.62, 0.78)],
    bulges: Array.from({ length: rng.int(3, 5) }, () => ({
      direction: randomDirection(rng),
      // More lumps than dents, and no dent deep enough to pinch the shape.
      size: rng.range(-0.1, 0.22),
      width: rng.range(0.45, 0.85),
    })),
    noise: { amplitude: rng.range(0.03, 0.06), frequency: rng.range(0.9, 1.4) },
  };
}

/** A lumpy, lopsided tuber: no two alike, and nothing symmetric to aim by. */
export function generatePotato(
  seed: string,
  resolution: StarShapeOptions = DEFAULT_POTATO_RESOLUTION,
): GeneratedObject<"potato", PotatoParams> {
  const rng = createRng(`potato:${seed}`);
  const params = samplePotatoParams(rng.fork("shape"));
  const noise = createNoise3(rng.fork("noise"));
  const f = params.noise.frequency;

  const mesh = buildStarShape((_theta, _phi, x, y, z) => {
    let r = 1;
    for (const b of params.bulges) {
      const angle = Math.acos(Math.max(-1, Math.min(1, x * b.direction[0] + y * b.direction[1] + z * b.direction[2])));
      r += b.size * Math.exp(-((angle / b.width) ** 2));
    }
    return r * (1 + params.noise.amplitude * fbm3(noise, x * f, y * f, z * f, 3));
  }, resolution);

  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    p[i] = p[i]! * params.radii[0];
    p[i + 1] = p[i + 1]! * params.radii[1];
    p[i + 2] = p[i + 2]! * params.radii[2];
  }
  return { kind: "potato", seed, params, density: POTATO_DENSITY, mesh };
}
