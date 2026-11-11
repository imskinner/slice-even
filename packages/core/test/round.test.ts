import { describe, expect, it } from "vitest";
import { gramsGoal, parseCutPlane, playerSeed, ruleTarget, scoreThirds } from "../src/round.ts";
import { generateObject } from "../src/generators/index.ts";
import { findPlaneAtFraction } from "../src/slice.ts";
import { meshVolume } from "../src/mesh.ts";

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

describe("new rules", () => {
  const object = generateObject("bread", "rules");
  const mass = meshVolume(object.mesh) * object.density;

  it("grams rounds ask for a round number of grams and score against that", () => {
    const goal = gramsGoal(0.3, mass);
    expect(goal % 5).toBe(0);
    expect(Math.abs(goal - 0.3 * mass)).toBeLessThanOrEqual(2.5);
    expect(ruleTarget({ type: "grams", share: 0.3 }, mass)).toBeCloseTo(goal / mass, 12);
    // Without the object's mass, the unrounded share.
    expect(ruleTarget({ type: "grams", share: 0.3 })).toBe(0.3);
    expect(ruleTarget({ type: "spin" })).toBe(0.5);
  });

  it("thirds: two parallel cuts at one and two thirds are perfect, in either order", () => {
    const a = findPlaneAtFraction(object.mesh, [1, 0, 0], 2 / 3);
    const b = findPlaneAtFraction(object.mesh, [1, 0, 0], 1 / 3);
    for (const [first, second] of [[a, b], [b, a]] as const) {
      const result = scoreThirds(object.mesh, first, second, object.density)!;
      expect(result.error).toBeLessThan(1e-6);
      expect(result.massMid).toBeCloseTo(mass / 3, 3);
      expect(result.massFront + result.massBack + result.massMid!).toBeCloseTo(mass, 6);
    }
  });

  it("thirds: an uneven slice is twice its distance from a third; misses and crossed cuts fail", () => {
    const a = findPlaneAtFraction(object.mesh, [1, 0, 0], 0.5);
    const b = findPlaneAtFraction(object.mesh, [1, 0, 0], 0.25);
    const result = scoreThirds(object.mesh, a, b, object.density);
    // Pieces of 25%, 25% and 50%: the worst is 1/6 off.
    expect(result!.error).toBeCloseTo(1 / 3, 4);

    const same = scoreThirds(object.mesh, a, a, object.density);
    expect(same!.error).toBe(1);
    const missed = scoreThirds(object.mesh, a, { point: [29, 0, 0], normal: [1, 0, 0] }, object.density);
    expect(missed!.error).toBe(1);
    const crossed = scoreThirds(object.mesh, a, { point: [0, 0, 0], normal: [0, 0, 1] }, object.density);
    expect(crossed).toBeNull();
  });
});
