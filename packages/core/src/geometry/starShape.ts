import type { Mesh } from "../mesh.ts";
import { buildPoleGrid } from "./poleGrid.ts";

/**
 * Radius for a direction on the unit sphere. `theta` is the polar angle from
 * +Y (0 = top, π = bottom), `phi` the azimuth from +X towards +Z, and
 * (x, y, z) the same direction as a unit vector.
 */
export type RadiusFn = (theta: number, phi: number, x: number, y: number, z: number) => number;

export interface StarShapeOptions {
  /** Latitude bands from pole to pole. */
  rings: number;
  /** Vertices around each ring. */
  segments: number;
}

/**
 * Builds a closed mesh whose surface point in every direction is
 * `radius(direction) * direction`. A single radius per direction means the
 * surface can never fold over itself, which keeps the mesh valid for volume
 * and slicing no matter how much noise a generator adds (as long as the
 * radius stays positive).
 *
 * The top pole (+Y) is vertex 0.
 */
export function buildStarShape(radius: RadiusFn, { rings, segments }: StarShapeOptions): Mesh {
  // Rings run top -> bottom and segments +X -> +Z, so segment × ring points outwards.
  return buildPoleGrid(rings, segments, (i, j, out, o) => {
    const theta = (Math.PI * i) / rings;
    const phi = (2 * Math.PI * j) / segments;
    // Pin the poles exactly on the axis; sin(π) is not exactly 0 in floating point.
    const s = i === 0 || i === rings ? 0 : Math.sin(theta);
    const x = s * Math.cos(phi);
    const y = i === 0 ? 1 : i === rings ? -1 : Math.cos(theta);
    const z = s * Math.sin(phi);
    const r = radius(theta, phi, x, y, z);
    if (!(r > 0)) throw new Error(`radius must be positive, got ${r} at theta=${theta} phi=${phi}`);
    out[o] = x * r;
    out[o + 1] = y * r;
    out[o + 2] = z * r;
  });
}
