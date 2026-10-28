import type { Mesh } from "../mesh.ts";
import { buildPoleGrid } from "./poleGrid.ts";
import type { StarShapeOptions } from "./starShape.ts";

/**
 * A tube around a spine that lies in the horizontal XZ plane, closed by a
 * pole at each end (the radius must reach 0 there). Cucumbers, bananas and
 * carrots are all this shape.
 */
export interface HorizontalSweep {
  /** Spine point at s in [0, 1]. */
  center(s: number): [number, number, number];
  /** Spine direction at s, as (x, z); need not be normalized. */
  tangent(s: number): [number, number];
  /**
   * Radius at s and angle alpha around the spine. (dx, dy, dz) is the unit
   * direction from the spine to the surface, so detail noise can be sampled
   * on a smooth reference surface.
   */
  radius(s: number, alpha: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number): number;
}

/**
 * `rings` run along the spine with cosine spacing (dense at the tips, where
 * the radius changes fastest), `segments` go around it.
 */
export function buildHorizontalSweep(sweep: HorizontalSweep, { rings, segments }: StarShapeOptions): Mesh {
  return buildPoleGrid(rings, segments, (i, j, out, o) => {
    const s = (1 - Math.cos((Math.PI * i) / rings)) / 2;
    const [cx, cy, cz] = sweep.center(s);
    if (i === 0 || i === rings) {
      out[o] = cx;
      out[o + 1] = cy;
      out[o + 2] = cz;
      return;
    }

    // Frame: T along the spine, B = +Y, N = B × T. With segments turning from
    // N towards B and rings running along T, segment × ring = B × T = N: outwards.
    const [tx, tz] = sweep.tangent(s);
    const tl = Math.hypot(tx, tz);
    const nx = tz / tl;
    const nz = -tx / tl;

    const alpha = (2 * Math.PI * j) / segments;
    const ca = Math.cos(alpha);
    const dx = ca * nx;
    const dy = Math.sin(alpha);
    const dz = ca * nz;

    const r = sweep.radius(s, alpha, dx, dy, dz, cx, cy, cz);
    if (!(r > 0)) throw new Error(`sweep radius must be positive, got ${r} at s=${s}`);
    out[o] = cx + dx * r;
    out[o + 1] = cy + dy * r;
    out[o + 2] = cz + dz * r;
  });
}

/** Quadratic Bézier from (-L/2, 0, 0) to (L/2, 0, 0) bowing `bend` cm along Z; x is linear in s. */
export function bowedSpine(length: number, bend: number): Pick<HorizontalSweep, "center" | "tangent"> {
  return {
    center: (s) => [-length / 2 + length * s, 0, 4 * bend * s * (1 - s)],
    tangent: (s) => [length, 4 * bend * (1 - 2 * s)],
  };
}

/** Rounded tip: 0 at the end, 1 once `capLength` away from it (quarter ellipse). */
export function roundTip(distanceFromEnd: number, capLength: number): number {
  if (distanceFromEnd >= capLength) return 1;
  const t = 1 - distanceFromEnd / capLength;
  return Math.sqrt(Math.max(0, 1 - t * t));
}
