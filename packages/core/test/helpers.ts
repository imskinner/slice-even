import type { Mesh } from "../src/mesh.ts";

/** Axis-aligned unit cube [0,1]³, outward winding. */
export function unitCube(): Mesh {
  // prettier-ignore
  const positions = new Float64Array([
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
    0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
  ]);
  // prettier-ignore
  const indices = new Uint32Array([
    0, 2, 1,  0, 3, 2,  // z = 0
    4, 5, 6,  4, 6, 7,  // z = 1
    0, 1, 5,  0, 5, 4,  // y = 0
    3, 7, 6,  3, 6, 2,  // y = 1
    0, 4, 7,  0, 7, 3,  // x = 0
    1, 2, 6,  1, 6, 5,  // x = 1
  ]);
  return { positions, indices };
}
