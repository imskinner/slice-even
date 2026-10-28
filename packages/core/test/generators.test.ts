import { describe, expect, it } from "vitest";
import { generateObject, OBJECT_KINDS, type ObjectKind } from "../src/generators/index.ts";
import { findManifoldProblems, meshBounds, meshVolume } from "../src/mesh.ts";
import { findBisectingPlane, sliceVolumes } from "../src/slice.ts";
import { createRng } from "../src/rng.ts";

const seeds = Array.from({ length: 40 }, (_, i) => `gen-${i}`);

/** Plausible real-world masses, grams. */
const MASS_RANGE: Record<ObjectKind, [number, number]> = {
  apple: [100, 330],
  cucumber: [150, 500],
  bread: [100, 600],
};

describe.each(OBJECT_KINDS)("%s", (kind) => {
  it("is deterministic per seed", () => {
    const a = generateObject(kind, "same");
    const b = generateObject(kind, "same");
    expect(a.mesh.positions).toEqual(b.mesh.positions);
    expect(generateObject(kind, "other").mesh.positions).not.toEqual(a.mesh.positions);
  });

  it("is always a closed, consistently wound mesh", () => {
    for (const seed of seeds) {
      expect(findManifoldProblems(generateObject(kind, seed).mesh), seed).toEqual([]);
    }
  });

  it("has a realistic, varying mass", () => {
    const masses = seeds.map((seed) => {
      const o = generateObject(kind, seed);
      return meshVolume(o.mesh) * o.density;
    });
    const [lo, hi] = MASS_RANGE[kind];
    expect(Math.min(...masses)).toBeGreaterThan(lo);
    expect(Math.max(...masses)).toBeLessThan(hi);
    expect(Math.max(...masses) / Math.min(...masses)).toBeGreaterThan(1.2);
  });

  it("halves always add up to the whole", () => {
    const rng = createRng(`cuts-${kind}`);
    for (const seed of seeds.slice(0, 10)) {
      const { mesh } = generateObject(kind, seed);
      const total = meshVolume(mesh);
      for (let i = 0; i < 5; i++) {
        const { front, back } = sliceVolumes(mesh, {
          point: [rng.range(-3, 3), rng.range(0, 2), rng.range(-2, 2)],
          normal: [rng.range(-1, 1), 0, rng.range(-1, 1)],
        });
        expect(Math.abs(front + back - total) / total).toBeLessThan(1e-9);
      }
    }
  });

  it("rests on a base below the origin and the ideal cut is not at x = 0", () => {
    let offCenter = 0;
    for (const seed of seeds.slice(0, 15)) {
      const { mesh } = generateObject(kind, seed);
      expect(meshBounds(mesh).min[1]).toBeLessThan(0);
      if (Math.abs(findBisectingPlane(mesh, [1, 0, 0]).point[0]) > 0.02) offCenter++;
    }
    expect(offCenter).toBeGreaterThan(7);
  });
});

describe("shape sanity", () => {
  it("cucumbers and loaves lie along X", () => {
    for (const kind of ["cucumber", "bread"] as const) {
      const { min, max } = meshBounds(generateObject(kind, "long").mesh);
      expect(max[0] - min[0], kind).toBeGreaterThan(1.5 * (max[2] - min[2]));
    }
  });

  it("loaves have a flat-ish base and a taller dome", () => {
    const { min, max } = meshBounds(generateObject("bread", "dome").mesh);
    expect(max[1]).toBeGreaterThan(2 * -min[1]);
  });
});
