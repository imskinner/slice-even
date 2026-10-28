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
