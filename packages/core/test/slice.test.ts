import { describe, expect, it } from "vitest";
import { findManifoldProblems, meshVolume } from "../src/mesh.ts";
import { buildStarShape } from "../src/geometry/starShape.ts";
import { findBisectingPlane, scoreCut, sliceVolumes } from "../src/slice.ts";
import { createRng } from "../src/rng.ts";
import { unitCube } from "./helpers.ts";

describe("meshVolume", () => {
  it("is exactly 1 for the unit cube", () => {
    expect(findManifoldProblems(unitCube())).toEqual([]);
    expect(meshVolume(unitCube())).toBeCloseTo(1, 12);
  });

  it("approaches 4/3 πr³ for a fine sphere", () => {
    const r = 4;
    const sphere = buildStarShape(() => r, { rings: 48, segments: 64 });
    expect(findManifoldProblems(sphere)).toEqual([]);
    const exact = (4 / 3) * Math.PI * r ** 3;
    expect(Math.abs(meshVolume(sphere) - exact) / exact).toBeLessThan(0.01);
  });
});

describe("sliceVolumes on the unit cube", () => {
  const cube = unitCube();

  it("axis-aligned cut", () => {
    const { front, back } = sliceVolumes(cube, { point: [0.3, 0, 0], normal: [1, 0, 0] });
    expect(front).toBeCloseTo(0.7, 12);
    expect(back).toBeCloseTo(0.3, 12);
  });

  it("diagonal cut through an edge region", () => {
    // x + y < 0.6 is a right-triangle prism with legs 0.6: volume 0.18.
    const { front, back } = sliceVolumes(cube, { point: [0.3, 0.3, 0], normal: [2, 2, 0] });
    expect(back).toBeCloseTo(0.18, 12);
    expect(front).toBeCloseTo(0.82, 12);
  });

  it("any plane through the center splits it in half", () => {
    const rng = createRng("cube-center");
    for (let i = 0; i < 50; i++) {
      const normal = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)] as const;
      const { front, back } = sliceVolumes(cube, { point: [0.5, 0.5, 0.5], normal });
      expect(front).toBeCloseTo(0.5, 12);
      expect(back).toBeCloseTo(0.5, 12);
    }
  });

  it("plane on a face or outside puts everything on one side", () => {
    const onFace = sliceVolumes(cube, { point: [0, 0, 1], normal: [0, 0, 1] });
    expect(onFace.front).toBeCloseTo(0, 12);
    expect(onFace.back).toBeCloseTo(1, 12);

    const miss = scoreCut(cube, { point: [5, 0, 0], normal: [1, 0, 0] }, 1);
    expect(miss.massFront).toBe(0);
    expect(miss.error).toBeCloseTo(1, 12);
  });
});

describe("findBisectingPlane", () => {
  it("finds the middle of the cube for any direction", () => {
    const plane = findBisectingPlane(unitCube(), [1, 2, 3]);
    const result = scoreCut(unitCube(), plane, 1);
    expect(result.error).toBeLessThan(1e-12);
  });
});
