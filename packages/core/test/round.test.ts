import { describe, expect, it } from "vitest";
import { parseCutPlane, playerSeed } from "../src/round.ts";

describe("playerSeed", () => {
  it("differs per player and per round", () => {
    expect(playerSeed("r1", "a")).not.toBe(playerSeed("r1", "b"));
    expect(playerSeed("r1", "a")).not.toBe(playerSeed("r2", "a"));
  });
});

describe("parseCutPlane", () => {
  it("accepts a vertical cut and normalizes the normal", () => {
    const result = parseCutPlane({ point: [1, 2, 3], normal: [3, 0, 4] });
    expect(result).toEqual({ plane: { point: [1, 2, 3], normal: [0.6, 0, 0.8] } });
  });

  it.each([
    ["not an object", null],
    ["missing normal", { point: [0, 0, 0] }],
    ["NaN", { point: [0, NaN, 0], normal: [1, 0, 0] }],
    ["tilted knife", { point: [0, 0, 0], normal: [1, 0.2, 0] }],
    ["vertical normal", { point: [0, 0, 0], normal: [0, 1, 0] }],
    ["far away", { point: [500, 0, 0], normal: [1, 0, 0] }],
    ["strings", { point: ["0", 0, 0], normal: [1, 0, 0] }],
  ])("rejects %s", (_label, input) => {
    expect(parseCutPlane(input)).toHaveProperty("error");
  });
});

describe("cutError and fraction planes", () => {
  it("matches the classic error for a 50% target and accepts either side", async () => {
    const { cutError } = await import("../src/round.ts");
    const r = { massFront: 30, massBack: 70, fractionFront: 0.3, error: 0.4 };
    expect(cutError(r, 0.5)).toBeCloseTo(0.4, 12);
    expect(cutError(r, 0.3)).toBeCloseTo(0, 12);
    expect(cutError({ ...r, massFront: 70, massBack: 30, fractionFront: 0.7 }, 0.3)).toBeCloseTo(0, 12);
    expect(cutError({ massFront: 0, massBack: 10, fractionFront: 0, error: 1 }, 0.3)).toBe(1);
  });

  it("finds the plane that leaves a given fraction in front", async () => {
    const { generateApple } = await import("../src/generators/apple.ts");
    const { findPlaneAtFraction, scoreCut } = await import("../src/slice.ts");
    const apple = generateApple("fraction");
    for (const f of [0.25, 1 / 3, 0.5, 0.7]) {
      const plane = findPlaneAtFraction(apple.mesh, [1, 0, 0], f);
      expect(scoreCut(apple.mesh, plane, apple.density).fractionFront).toBeCloseTo(f, 9);
    }
  });
});
