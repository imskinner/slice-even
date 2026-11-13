import { describe, expect, it } from "vitest";
import { generateObject, OBJECT_KINDS } from "../src/generators/index.ts";
import { meshVolume, type Mesh } from "../src/mesh.ts";
import { findPlaneAtFraction, sliceVolumes, type Plane } from "../src/slice.ts";
import { splitMesh, type SplitPiece } from "../src/splitMesh.ts";

const asMesh = (piece: SplitPiece): Mesh => ({ positions: Float64Array.from(piece.positions), indices: piece.indices });

/** A closed surface encloses the same volume wherever the origin is; an open one does not. */
function volumeIfClosed(piece: SplitPiece): number {
  const mesh = asMesh(piece);
  const volume = meshVolume(mesh);
  const moved: Mesh = { positions: mesh.positions.map((v, i) => v + [37, -11, 23][i % 3]!), indices: mesh.indices };
  expect(meshVolume(moved)).toBeCloseTo(volume, 2);
  return volume;
}

const PLANES: Plane[] = [
  { point: [0, 0, 0], normal: [1, 0, 0] },
  { point: [0.7, 0, -0.4], normal: [0.3, 0, 1] },
  { point: [-1.1, 0, 0.6], normal: [-1, 0, 0.8] },
  // Lengthwise through the long shapes: bowed ones can be crossed in more than one loop.
  { point: [0, 0, 0.3], normal: [0, 0, 1] },
];

describe("splitMesh", () => {
  it.each(OBJECT_KINDS)("splits a %s into two closed pieces with the scored volumes", (kind) => {
    const { mesh } = generateObject(kind, `split-${kind}`);
    for (const plane of PLANES) {
      const { front, back } = splitMesh(mesh.positions, mesh.indices, plane);
      const wanted = sliceVolumes(mesh, plane);
      // Float32 output: a few parts in 100 000.
      expect(volumeIfClosed(front)).toBeCloseTo(wanted.front, 1);
      expect(volumeIfClosed(back)).toBeCloseTo(wanted.back, 1);
      expect(Math.abs(volumeIfClosed(front) - wanted.front) / (wanted.front + wanted.back)).toBeLessThan(1e-4);
      // The skin comes first, then the cut face.
      expect(front.capStart).toBeGreaterThan(0);
      expect(front.indices.length / 3).toBeGreaterThan(front.capStart);
    }
  });

  it("a piece can be cut again, keeping the first cut face apart from the skin (three slices)", () => {
    const { mesh } = generateObject("bread", "thirds");
    const total = meshVolume(mesh);
    const low = findPlaneAtFraction(mesh, [1, 0, 0], 2 / 3);
    const high = findPlaneAtFraction(mesh, [1, 0, 0], 1 / 3);
    const first = splitMesh(mesh.positions, mesh.indices, low);
    const second = splitMesh(first.front.positions, first.front.indices, high, first.front.capStart);
    const pieces = [first.back, second.back, second.front];
    for (const piece of pieces) expect(volumeIfClosed(piece) / total).toBeCloseTo(1 / 3, 3);
    // The middle slice has two cut faces: the old one and the new one.
    const middle = second.back;
    const skinOfWhole = first.front.capStart;
    expect(middle.capStart).toBeLessThan(skinOfWhole);
    expect(middle.indices.length / 3 - middle.capStart).toBeGreaterThan(first.front.indices.length / 3 - first.front.capStart);
  });

  it("a plane that misses leaves everything on one side", () => {
    const { mesh } = generateObject("apple", "miss");
    const { front, back } = splitMesh(mesh.positions, mesh.indices, { point: [25, 0, 0], normal: [1, 0, 0] });
    expect(front.indices.length).toBe(0);
    expect(back.indices.length).toBe(mesh.indices.length);
    expect(back.capStart).toBe(mesh.indices.length / 3);
  });
});
