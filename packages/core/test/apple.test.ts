import { describe, expect, it } from "vitest";
import { generateApple } from "../src/generators/apple.ts";
import { findManifoldProblems, meshVolume } from "../src/mesh.ts";
import { findBisectingPlane, scoreCut, sliceVolumes } from "../src/slice.ts";
import { createRng } from "../src/rng.ts";

const seeds = Array.from({ length: 100 }, (_, i) => `seed-${i}`);

describe("generateApple", () => {
  it("is identical for the same seed", () => {
    const a = generateApple("same");
    const b = generateApple("same");
    expect(a.params).toEqual(b.params);
    expect(a.mesh.positions).toEqual(b.mesh.positions);
    expect(a.mesh.indices).toEqual(b.mesh.indices);
  });

  it("differs between seeds", () => {
    expect(generateApple("one").mesh.positions).not.toEqual(generateApple("two").mesh.positions);
  });

  it("always produces a closed, consistently wound mesh", () => {
    for (const seed of seeds) {
      expect(findManifoldProblems(generateApple(seed).mesh), seed).toEqual([]);
    }
  });

  it("weighs like a real apple (roughly 100–330 g)", () => {
    const masses = seeds.map((seed) => {
      const apple = generateApple(seed);
      return meshVolume(apple.mesh) * apple.density;
    });
    expect(Math.min(...masses)).toBeGreaterThan(100);
    expect(Math.max(...masses)).toBeLessThan(330);
    // And they actually vary.
    expect(Math.max(...masses) - Math.min(...masses)).toBeGreaterThan(50);
  });
});

describe("slicing apples", () => {
  it("both halves always add up to the whole", () => {
    const rng = createRng("random-cuts");
    for (const seed of seeds.slice(0, 30)) {
      const { mesh } = generateApple(seed);
      const total = meshVolume(mesh);
      for (let i = 0; i < 10; i++) {
        const { front, back } = sliceVolumes(mesh, {
          point: [rng.range(-2, 2), rng.range(-2, 2), rng.range(-2, 2)],
          normal: [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)],
        });
        expect(front).toBeGreaterThanOrEqual(-1e-9);
        expect(back).toBeGreaterThanOrEqual(-1e-9);
        expect(Math.abs(front + back - total) / total).toBeLessThan(1e-9);
      }
    }
  });

  it("the ideal vertical cut is off-center, so eyeballing the middle is not enough", () => {
    const offsets = seeds.slice(0, 30).map((seed) => {
      const apple = generateApple(seed);
      const plane = findBisectingPlane(apple.mesh, [1, 0, 0]);
      expect(scoreCut(apple.mesh, plane, apple.density).error).toBeLessThan(1e-9);
      return Math.abs(plane.point[0]);
    });
    // Lean, squash and noise should push the true middle a bit off the axis.
    expect(offsets.filter((d) => d > 0.02).length).toBeGreaterThan(10);
  });

  it("a cut 1 mm off the ideal plane costs only a few percent", () => {
    const apple = generateApple("near-miss");
    const ideal = findBisectingPlane(apple.mesh, [1, 0, 0]);
    const off = scoreCut(
      apple.mesh,
      { point: [ideal.point[0] + 0.1, ideal.point[1], ideal.point[2]], normal: [1, 0, 0] },
      apple.density,
    );
    expect(off.error).toBeGreaterThan(0.01);
    expect(off.error).toBeLessThan(0.06);
  });
});
