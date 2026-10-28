import { det3, meshBounds, type Mesh, type Vec3 } from "./mesh.ts";

/** A cut. `normal` need not be unit length; "front" is the side it points to. */
export interface Plane {
  point: Vec3;
  normal: Vec3;
}

export interface SliceVolumes {
  front: number;
  back: number;
}

/**
 * Volume on each side of a plane, without building the cut geometry.
 *
 * Each half is a closed surface made of the clipped original triangles plus a
 * flat cap lying in the plane. Summing tetrahedra against an apex that lies
 * *on the plane* makes every cap tetrahedron flat, i.e. zero volume, so the
 * cap never needs to be triangulated. That matters: cross-sections of lumpy
 * shapes can have several loops or holes, and triangulating them robustly is
 * the hard part of mesh slicing. The renderer still builds a cap for looks,
 * but the score does not depend on it.
 */
export function sliceVolumes(mesh: Mesh, plane: Plane): SliceVolumes {
  const [px, py, pz] = plane.point;
  const len = Math.hypot(...plane.normal);
  if (!(len > 0)) throw new Error("plane normal must be non-zero");
  const nx = plane.normal[0] / len;
  const ny = plane.normal[1] / len;
  const nz = plane.normal[2] / len;

  const p = mesh.positions;
  const idx = mesh.indices;
  // Scratch polygon: a triangle clipped by one plane has at most 4 vertices.
  const poly = new Float64Array(12);
  const tri = new Float64Array(9);
  const dist = new Float64Array(3);
  let front = 0;
  let back = 0;

  for (let t = 0; t < idx.length; t += 3) {
    let allFront = true;
    let allBack = true;
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k]! * 3;
      // Work relative to the plane point so it is the tetrahedron apex.
      const x = p[v]! - px;
      const y = p[v + 1]! - py;
      const z = p[v + 2]! - pz;
      tri[k * 3] = x;
      tri[k * 3 + 1] = y;
      tri[k * 3 + 2] = z;
      const d = x * nx + y * ny + z * nz;
      dist[k] = d;
      if (d < 0) allFront = false;
      if (d > 0) allBack = false;
    }

    if (allFront || allBack) {
      const v = det3(tri[0]!, tri[1]!, tri[2]!, tri[3]!, tri[4]!, tri[5]!, tri[6]!, tri[7]!, tri[8]!) / 6;
      if (allFront) front += v;
      else back += v;
      continue;
    }
    front += clippedVolume(tri, dist, 1, poly);
    back += clippedVolume(tri, dist, -1, poly);
  }

  return { front, back };
}

/**
 * Sutherland–Hodgman clip of one triangle to the side where sign * d >= 0,
 * then the fan volume of the resulting convex polygon against the origin.
 */
function clippedVolume(tri: Float64Array, dist: Float64Array, sign: 1 | -1, poly: Float64Array): number {
  let n = 0;
  for (let k = 0; k < 3; k++) {
    const k2 = (k + 1) % 3;
    const da = sign * dist[k]!;
    const db = sign * dist[k2]!;
    if (da >= 0) {
      poly[n * 3] = tri[k * 3]!;
      poly[n * 3 + 1] = tri[k * 3 + 1]!;
      poly[n * 3 + 2] = tri[k * 3 + 2]!;
      n++;
    }
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const s = da / (da - db);
      for (let c = 0; c < 3; c++) {
        poly[n * 3 + c] = tri[k * 3 + c]! + s * (tri[k2 * 3 + c]! - tri[k * 3 + c]!);
      }
      n++;
    }
  }

  let vol = 0;
  for (let i = 1; i + 1 < n; i++) {
    vol += det3(
      poly[0]!, poly[1]!, poly[2]!,
      poly[i * 3]!, poly[i * 3 + 1]!, poly[i * 3 + 2]!,
      poly[(i + 1) * 3]!, poly[(i + 1) * 3 + 1]!, poly[(i + 1) * 3 + 2]!,
    );
  }
  return vol / 6;
}

export interface CutResult {
  /** Grams. */
  massFront: number;
  massBack: number;
  /** massFront / total, 0.5 is a perfect cut. */
  fractionFront: number;
  /**
   * |front - back| / total. 0 is perfect, 1 means the knife missed.
   * Players get different objects, so rounds are ranked by this relative
   * error, not by the difference in grams.
   */
  error: number;
}

export function scoreCut(mesh: Mesh, plane: Plane, density: number): CutResult {
  const { front, back } = sliceVolumes(mesh, plane);
  const massFront = Math.max(0, front) * density;
  const massBack = Math.max(0, back) * density;
  const total = massFront + massBack;
  return {
    massFront,
    massBack,
    fractionFront: total > 0 ? massFront / total : 0,
    error: total > 0 ? Math.abs(massFront - massBack) / total : 1,
  };
}

/**
 * The plane with the given normal that splits the volume exactly in half,
 * found by bisection along the normal. Used to show the ideal cut after a
 * round, and in tests.
 */
export function findBisectingPlane(mesh: Mesh, normal: Vec3, iterations = 60): Plane {
  const len = Math.hypot(...normal);
  const n: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len];
  const { min, max } = meshBounds(mesh);
  // Project the bounding box corners to bracket the offset along n.
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const d = x * n[0] + y * n[1] + z * n[2];
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
    }
  }

  const planeAt = (d: number): Plane => ({ point: [n[0] * d, n[1] * d, n[2] * d], normal: n });
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const { front, back } = sliceVolumes(mesh, planeAt(mid));
    if (front > back) lo = mid;
    else hi = mid;
  }
  return planeAt((lo + hi) / 2);
}
