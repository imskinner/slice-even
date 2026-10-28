import type { Mesh } from "../mesh.ts";

/**
 * Writes the position of grid vertex (ring, segment) into `out`.
 * Ring 0 and ring `rings` are the two poles (segment is always 0 there);
 * rings 1..rings-1 have `segments` vertices each, closing around.
 */
export type GridPosition = (ring: number, segment: number, out: Float64Array, offset: number) => void;

/**
 * Closed mesh with the topology of a UV sphere: a start pole, `rings - 1`
 * loops of `segments` vertices, and an end pole. Star shapes and swept tubes
 * both use it.
 *
 * Winding contract: triangles face outwards when (direction of increasing
 * segment) × (direction of increasing ring) points out of the surface.
 */
export function buildPoleGrid(rings: number, segments: number, position: GridPosition): Mesh {
  if (rings < 2 || segments < 3) throw new Error("pole grid needs rings >= 2 and segments >= 3");

  const ringVerts = (rings - 1) * segments;
  const positions = new Float64Array((ringVerts + 2) * 3);
  const start = 0;
  const end = ringVerts + 1;
  const ringStart = (i: number) => 1 + (i - 1) * segments;

  position(0, 0, positions, start * 3);
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      position(i, j, positions, (ringStart(i) + j) * 3);
    }
  }
  position(rings, 0, positions, end * 3);

  const triCount = 2 * segments + 2 * segments * (rings - 2);
  const indices = new Uint32Array(triCount * 3);
  let t = 0;
  const tri = (a: number, b: number, c: number) => {
    indices[t++] = a;
    indices[t++] = b;
    indices[t++] = c;
  };

  const first = ringStart(1);
  for (let j = 0; j < segments; j++) {
    tri(start, first + ((j + 1) % segments), first + j);
  }
  for (let i = 1; i < rings - 1; i++) {
    const a = ringStart(i);
    const b = ringStart(i + 1);
    for (let j = 0; j < segments; j++) {
      const jn = (j + 1) % segments;
      tri(a + j, a + jn, b + j);
      tri(a + jn, b + jn, b + j);
    }
  }
  const last = ringStart(rings - 1);
  for (let j = 0; j < segments; j++) {
    tri(last + j, last + ((j + 1) % segments), end);
  }

  return { positions, indices };
}
