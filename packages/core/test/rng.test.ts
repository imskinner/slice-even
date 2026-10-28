import { describe, expect, it } from "vitest";
import { createRng } from "../src/rng.ts";
import { createNoise3 } from "../src/noise.ts";

const take = (seed: string, n: number) => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe("createRng", () => {
  it("repeats the same sequence for the same seed", () => {
    expect(take("round-42", 100)).toEqual(take("round-42", 100));
  });

  it("gives different sequences for different seeds", () => {
    expect(take("a", 10)).not.toEqual(take("b", 10));
  });

  it("stays in range", () => {
    const rng = createRng("range");
    for (let i = 0; i < 10_000; i++) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.int(-3, 3);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(3);
    }
  });

  it("forks are independent of how much the parent was used", () => {
    const a = createRng("s");
    const b = createRng("s");
    b.next();
    b.next();
    expect(a.fork("shape").next()).toBe(b.fork("shape").next());
  });
});

describe("createNoise3", () => {
  it("is deterministic per seed and roughly in [-1, 1]", () => {
    const n1 = createNoise3(createRng("noise"));
    const n2 = createNoise3(createRng("noise"));
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 5000; i++) {
      const x = i * 0.137;
      const y = i * 0.071 - 3;
      const z = i * 0.013 + 1;
      const v = n1(x, y, z);
      expect(v).toBe(n2(x, y, z));
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThan(-1.1);
    expect(max).toBeLessThan(1.1);
    // Not degenerate.
    expect(max - min).toBeGreaterThan(1);
  });
});
