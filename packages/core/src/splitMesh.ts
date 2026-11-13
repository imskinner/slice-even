import type { Plane } from "./slice.ts";

/** One side of a split mesh, closed again with a flat face where the plane went. */
export interface SplitPiece {
  positions: Float32Array;
  indices: Uint32Array;
  /** Triangles from this index on are cut faces (flesh); the ones before are the original surface. */
  capStart: number;
}

/**
 * Cuts a closed triangle mesh in two along a plane and closes both pieces
 * with a flat cap: the geometry the renderer shows after a cut.
 *
 * This is deliberately not a general CSG: one pass clips every triangle
 * against the plane, the cut edges are chained into loops, and each loop is
 * triangulated in the plane. For the objects in this game (a few thousand
 * triangles, no cavities) that takes a few milliseconds, where a general
 * boolean took most of a tenth of a second, right at the moment of the cut.
 *
 * `capStart` (in triangles) marks where the input's own cut faces begin, so
 * a piece can be cut again and keep them apart from its skin. Cap vertices
 * are separate from the skin's, so the cap shades flat.
 *
 * The score never comes from here: see sliceVolumes.
 */
export function splitMesh(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  plane: Plane,
  capStart = indices.length / 3,
): { front: SplitPiece; back: SplitPiece } {
  const len = Math.hypot(...plane.normal);
  if (!(len > 0)) throw new Error("plane normal must be non-zero");
  const nx = plane.normal[0] / len;
  const ny = plane.normal[1] / len;
  const nz = plane.normal[2] / len;
  const [px, py, pz] = plane.point;
  const vertexCount = positions.length / 3;
  const triangles = indices.length / 3;

  // Vertices at the same position are one vertex here (a piece that was cut
  // before has its rim twice, once for the skin and once for the cap), so an
  // edge the plane crosses always gets the same cut point from both sides.
  // A mesh straight from a generator has no such doubles: skip the search.
  const canon = new Uint32Array(vertexCount);
  if (capStart >= triangles) {
    for (let v = 0; v < vertexCount; v++) canon[v] = v;
  } else {
    const byPosition = new Map<string, number>();
    for (let v = 0; v < vertexCount; v++) {
      const key = `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
      const first = byPosition.get(key);
      if (first === undefined) {
        byPosition.set(key, v);
        canon[v] = v;
      } else canon[v] = first;
    }
  }

  // Signed distance to the plane. A vertex exactly on it counts as in front,
  // so no triangle degenerates into a zero-length cut.
  const dist = new Float64Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const d = (positions[v * 3]! - px) * nx + (positions[v * 3 + 1]! - py) * ny + (positions[v * 3 + 2]! - pz) * nz;
    dist[v] = Math.abs(d) < 1e-9 ? 1e-9 : d;
  }

  // Cut points, one per crossed edge, shared by everything that touches it.
  const cutXyz: number[] = [];
  const cutOfEdge = new Map<number, number>();
  const cutPoint = (a: number, b: number): number => {
    const [lo, hi] = canon[a]! < canon[b]! ? [canon[a]!, canon[b]!] : [canon[b]!, canon[a]!];
    const key = lo * vertexCount + hi;
    let id = cutOfEdge.get(key);
    if (id === undefined) {
      const t = dist[lo]! / (dist[lo]! - dist[hi]!);
      id = cutXyz.length / 3;
      for (let c = 0; c < 3; c++) cutXyz.push(positions[lo * 3 + c]! + t * (positions[hi * 3 + c]! - positions[lo * 3 + c]!));
      cutOfEdge.set(key, id);
    }
    return id;
  };

  const sides = [new PieceBuilder(positions), new PieceBuilder(positions)];
  const [front, back] = sides as [PieceBuilder, PieceBuilder];

  for (let t = 0; t < triangles; t++) {
    const cap = t >= capStart;
    let a = indices[t * 3]!;
    let b = indices[t * 3 + 1]!;
    let c = indices[t * 3 + 2]!;
    const fa = dist[a]! > 0;
    const fb = dist[b]! > 0;
    const fc = dist[c]! > 0;
    if (fa === fb && fb === fc) {
      (fa ? front : back).triangle(cap, a, b, c);
      continue;
    }
    // Rotate (keeping the winding) so `a` is the vertex alone on its side.
    if (fb !== fa && fb !== fc) [a, b, c] = [b, c, a];
    else if (fc !== fa && fc !== fb) [a, b, c] = [c, a, b];
    const alone = dist[a]! > 0 ? front : back;
    const pair = alone === front ? back : front;
    const ab = cutPoint(a, b);
    const ca = cutPoint(c, a);
    alone.cutTriangle(cap, a, ab, ca);
    pair.cutQuad(cap, ab, b, c, ca);
    // Each piece's skin now has a boundary edge along the cut; its cap must
    // run along it the other way for the surface to stay closed.
    alone.segment(ca, ab);
    pair.segment(ab, ca);
  }

  // Coordinates within the plane, for triangulating the caps.
  const [ux, uy, uz] = Math.abs(nx) > 0.9 ? normalize(cross([0, 1, 0], [nx, ny, nz])) : normalize(cross([1, 0, 0], [nx, ny, nz]));
  const [vx, vy, vz] = cross([nx, ny, nz], [ux, uy, uz]);
  const flat = new Float64Array((cutXyz.length / 3) * 2);
  for (let i = 0; i < cutXyz.length / 3; i++) {
    const [x, y, z] = [cutXyz[i * 3]!, cutXyz[i * 3 + 1]!, cutXyz[i * 3 + 2]!];
    flat[i * 2] = x * ux + y * uy + z * uz;
    flat[i * 2 + 1] = x * vx + y * vy + z * vz;
  }

  return { front: front.finish(cutXyz, flat), back: back.finish(cutXyz, flat) };
}

type Vec = [number, number, number];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (v: Vec): Vec => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Collects one piece: its skin, its earlier cut faces, and the cut edges to close. */
class PieceBuilder {
  private readonly out: number[] = [];
  private readonly skin: number[] = [];
  private readonly caps: number[] = [];
  private readonly vertexOf = new Map<number, number>();
  private readonly cutVertexOf = new Map<number, number>();
  private readonly pendingCuts: [slot: number, cut: number][] = [];
  /** Directed cut edges: from one cut point to the next, around each loop. */
  private readonly next = new Map<number, number>();

  private readonly source: ArrayLike<number>;

  constructor(source: ArrayLike<number>) {
    this.source = source;
  }

  private vertex(v: number): number {
    let id = this.vertexOf.get(v);
    if (id === undefined) {
      id = this.out.length / 3;
      this.out.push(this.source[v * 3]!, this.source[v * 3 + 1]!, this.source[v * 3 + 2]!);
      this.vertexOf.set(v, id);
    }
    return id;
  }

  /** A cut point as a vertex of this piece's surface; its position is filled in at the end. */
  private cutVertex(cut: number): number {
    let id = this.cutVertexOf.get(cut);
    if (id === undefined) {
      id = this.out.length / 3;
      this.out.push(0, 0, 0);
      this.pendingCuts.push([id, cut]);
      this.cutVertexOf.set(cut, id);
    }
    return id;
  }

  triangle(cap: boolean, a: number, b: number, c: number) {
    (cap ? this.caps : this.skin).push(this.vertex(a), this.vertex(b), this.vertex(c));
  }

  cutTriangle(cap: boolean, a: number, ab: number, ca: number) {
    (cap ? this.caps : this.skin).push(this.vertex(a), this.cutVertex(ab), this.cutVertex(ca));
  }

  cutQuad(cap: boolean, ab: number, b: number, c: number, ca: number) {
    const list = cap ? this.caps : this.skin;
    const [p, q] = [this.cutVertex(ab), this.cutVertex(ca)];
    const [vb, vc] = [this.vertex(b), this.vertex(c)];
    list.push(p, vb, vc, p, vc, q);
  }

  segment(from: number, to: number) {
    this.next.set(from, to);
  }

  finish(cutXyz: number[], flat: Float64Array): SplitPiece {
    for (const [slot, cut] of this.pendingCuts) {
      for (let c = 0; c < 3; c++) this.out[slot * 3 + c] = cutXyz[cut * 3 + c]!;
    }
    // Close the cut: walk each loop of cut edges and fill it in. The loop's
    // points become new vertices, apart from the skin's, so the face is flat.
    const newCap: number[] = [];
    const seen = new Set<number>();
    for (const start of this.next.keys()) {
      if (seen.has(start)) continue;
      const loop: number[] = [];
      for (let at: number | undefined = start; at !== undefined && !seen.has(at); at = this.next.get(at)) {
        seen.add(at);
        loop.push(at);
      }
      if (loop.length < 3) continue;
      const base = this.out.length / 3;
      for (const cut of loop) this.out.push(cutXyz[cut * 3]!, cutXyz[cut * 3 + 1]!, cutXyz[cut * 3 + 2]!);
      for (const corner of earClip(loop, flat)) newCap.push(base + corner);
    }
    const indices = new Uint32Array(this.skin.length + this.caps.length + newCap.length);
    indices.set(this.skin, 0);
    indices.set(this.caps, this.skin.length);
    indices.set(newCap, this.skin.length + this.caps.length);
    return { positions: new Float32Array(this.out), indices, capStart: this.skin.length / 3 };
  }
}

/**
 * Triangulates a simple polygon by clipping ears. `loop` lists cut point
 * ids in order; the result is corners as positions in `loop`, three per
 * triangle, wound like the loop. Cross-sections here have a few hundred
 * points at most, so the quadratic search is fine.
 */
function earClip(loop: number[], flat: Float64Array): number[] {
  const x = (i: number) => flat[loop[i]! * 2]!;
  const y = (i: number) => flat[loop[i]! * 2 + 1]!;
  let area = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) area += x(j) * y(i) - x(i) * y(j);
  const sign = area < 0 ? -1 : 1;
  // How convex the corner at b is, in the polygon's own winding (positive = convex).
  const turn = (a: number, b: number, c: number) => sign * ((x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a)));

  const ring = loop.map((_, i) => i);
  const triangles: number[] = [];
  while (ring.length > 3) {
    let ear = -1;
    let widest = -Infinity;
    let fallback = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length]!;
      const b = ring[i]!;
      const c = ring[(i + 1) % ring.length]!;
      const t = turn(a, b, c);
      if (t > widest) {
        widest = t;
        fallback = i;
      }
      if (t <= 1e-12) continue;
      // An ear holds no other corner of the polygon.
      let empty = true;
      for (const p of ring) {
        if (p === a || p === b || p === c) continue;
        if (turn(a, b, p) >= 0 && turn(b, c, p) >= 0 && turn(c, a, p) >= 0) {
          empty = false;
          break;
        }
      }
      if (empty) {
        ear = i;
        break;
      }
    }
    // Numerically degenerate outlines can leave no clean ear: take the most convex corner and go on.
    if (ear < 0) ear = fallback;
    const a = ring[(ear + ring.length - 1) % ring.length]!;
    const c = ring[(ear + 1) % ring.length]!;
    triangles.push(a, ring[ear]!, c);
    ring.splice(ear, 1);
  }
  triangles.push(ring[0]!, ring[1]!, ring[2]!);
  return triangles;
}
