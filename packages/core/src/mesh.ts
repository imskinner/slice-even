/**
 * Plain triangle mesh, independent of any renderer. Units are centimeters,
 * so volumes come out in cm³ and masses in grams (with density in g/cm³).
 *
 * Triangles wind counter-clockwise seen from outside, so the signed volume of
 * a closed mesh is positive.
 */
export interface Mesh {
  /** xyz triplets. Float64 because the scoring server compares tiny differences. */
  positions: Float64Array;
  /** Vertex index triplets. */
  indices: Uint32Array;
}

export type Vec3 = readonly [number, number, number];

export function vertexCount(mesh: Mesh): number {
  return mesh.positions.length / 3;
}

export function triangleCount(mesh: Mesh): number {
  return mesh.indices.length / 3;
}

/** Signed volume via the divergence theorem: sum of tetrahedra (origin, a, b, c). */
export function meshVolume(mesh: Mesh): number {
  const p = mesh.positions;
  const idx = mesh.indices;
  let sum = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3;
    const b = idx[t + 1]! * 3;
    const c = idx[t + 2]! * 3;
    sum += det3(
      p[a]!, p[a + 1]!, p[a + 2]!,
      p[b]!, p[b + 1]!, p[b + 2]!,
      p[c]!, p[c + 1]!, p[c + 2]!,
    );
  }
  return sum / 6;
}

/** a · (b × c) */
export function det3(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  return ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export function meshBounds(mesh: Mesh): Bounds {
  const p = mesh.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

/**
 * Checks the mesh is closed and consistently wound: every directed edge
 * appears exactly once and its reverse appears exactly once. Volume and
 * slicing are only meaningful for meshes that pass this.
 */
export function findManifoldProblems(mesh: Mesh): string[] {
  const n = vertexCount(mesh);
  const idx = mesh.indices;
  const directed = new Map<number, number>();
  const problems: string[] = [];

  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) {
      problems.push(`degenerate triangle ${t / 3}`);
    }
    for (let e = 0; e < 3; e++) {
      const key = tri[e]! * n + tri[(e + 1) % 3]!;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }

  for (const [key, count] of directed) {
    const a = Math.floor(key / n);
    const b = key % n;
    if (count !== 1) problems.push(`edge ${a}->${b} used ${count} times`);
    if (!directed.has(b * n + a)) problems.push(`edge ${a}->${b} has no opposite (hole or flipped triangle)`);
    if (problems.length > 20) break;
  }
  return problems;
}
