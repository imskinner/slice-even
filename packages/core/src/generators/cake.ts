import { createRng, type Rng } from "../rng.ts";
import { createNoise3 } from "../noise.ts";
import { buildStarShape, type StarShapeOptions } from "../geometry/starShape.ts";
import { smoothstep } from "../math.ts";
import type { GeneratedObject } from "./types.ts";

export type CakeFlavor = "vanilla" | "chocolate" | "redVelvet";
export type CakeFrosting = "white" | "pink" | "chocolate";

/** A round layer cake standing on its base near y = -heightBottom. */
export interface CakeParams {
  radius: number;
  heightTop: number;
  heightBottom: number;
  /** Vertical profile sharpness: higher = straighter sides and flatter top. */
  exponent: number;
  /** Slight oval footprint and slump, so the middle is never exactly central. */
  oval: { amount: number; angle: number };
  slump: { x: number; z: number };
  /** Frosting dollops around the top edge. */
  dollops: { count: number; height: number; phase: number };
  noise: number;
  /** Cosmetic, for the shaders. */
  layers: number;
  flavor: CakeFlavor;
  frosting: CakeFrosting;
  sprinkles: boolean;
}

/** Sponge with buttercream: about half the density of water. */
export const CAKE_DENSITY = 0.45;
export const DEFAULT_CAKE_RESOLUTION: StarShapeOptions = { rings: 72, segments: 128 };

export function sampleCakeParams(rng: Rng): CakeParams {
  const look = rng.fork("look");
  return {
    radius: rng.range(5, 6.5),
    heightTop: rng.range(3.5, 5),
    heightBottom: rng.range(0.6, 1.0),
    exponent: rng.range(7, 11),
    oval: { amount: rng.range(0.015, 0.045), angle: rng.range(0, Math.PI) },
    slump: { x: rng.range(-0.04, 0.04), z: rng.range(-0.04, 0.04) },
    dollops: { count: rng.int(10, 16), height: rng.range(0.25, 0.45), phase: rng.range(0, 2 * Math.PI) },
    noise: rng.range(0.004, 0.012),
    layers: look.int(2, 3),
    flavor: look.pick(["vanilla", "chocolate", "redVelvet"] as const),
    frosting: look.pick(["white", "pink", "chocolate"] as const),
    sprinkles: look.next() < 0.6,
  };
}

/**
 * Radius ratio of the smooth cake (no dollops or noise): 1 on the surface.
 * The interior shader mirrors this to find the frosting layer.
 */
export function cakeShapeRatio(params: CakeParams, x: number, y: number, z: number): number {
  const azimuth = Math.atan2(z, x);
  const R = params.radius * (1 + params.oval.amount * Math.cos(2 * (azimuth - params.oval.angle)));
  const b = y > 0 ? params.heightTop : params.heightBottom;
  const e = params.exponent;
  return ((Math.hypot(x, z) / R) ** e + Math.abs(y / b) ** e) ** (1 / e);
}

export function generateCake(
  seed: string,
  resolution: StarShapeOptions = DEFAULT_CAKE_RESOLUTION,
): GeneratedObject<"cake", CakeParams> {
  const rng = createRng(`cake:${seed}`);
  const params = sampleCakeParams(rng.fork("shape"));
  const noise = createNoise3(rng.fork("noise"));
  const { dollops } = params;

  const mesh = buildStarShape((_theta, phi, x, y, z) => {
    const r0 = 1 / cakeShapeRatio(params, x, y, z);
    const py = y * r0;
    // Dollops sit on the rim: near the top, near the outer edge.
    const rim =
      smoothstep(params.heightTop * 0.75, params.heightTop * 0.98, py) *
      smoothstep(0.5, 0.9, (Math.hypot(x, z) * r0) / params.radius);
    // Wide, rounded bumps (a sharp power of cos makes them look like ears).
    const wave = 0.5 + 0.5 * Math.cos(dollops.count * phi + dollops.phase);
    const bump = dollops.height * rim * wave * wave;
    return r0 * (1 + params.noise * noise(x * 3, y * 3, z * 3)) + bump;
  }, resolution);

  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const y = p[i + 1]!;
    p[i] = p[i]! + y * params.slump.x;
    p[i + 2] = p[i + 2]! + y * params.slump.z;
  }
  return { kind: "cake", seed, params, density: CAKE_DENSITY, mesh };
}
