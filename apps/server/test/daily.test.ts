import { describe, expect, it } from "vitest";
import { findBisectingPlane, generateObject } from "@slice-even/core";
import { dailyDate, dailyPuzzle, leaderboard, msUntilNextDaily, submitDaily, type DailyData } from "../src/daily.ts";

const NOON = Date.UTC(2026, 10, 3, 12);

describe("daily challenge", () => {
  it("is the same puzzle for everyone on a given day and numbered from launch", () => {
    expect(dailyPuzzle("2026-11-01").number).toBe(1);
    expect(dailyPuzzle("2026-11-03")).toEqual(dailyPuzzle("2026-11-03"));
    expect(dailyPuzzle("2026-11-03").number).toBe(3);
    expect(dailyDate(NOON)).toBe("2026-11-03");
    expect(msUntilNextDaily(NOON)).toBe(12 * 3600 * 1000);
  });

  it("allows one attempt per player and ranks everyone", () => {
    const data: DailyData = { date: "2026-11-03", entries: [] };
    const puzzle = dailyPuzzle(data.date);
    const perfect = findBisectingPlane(generateObject(puzzle.kind, puzzle.seed).mesh, [1, 0, 0]);

    const sloppy = submitDaily(data, "a", "ta", "Ana", { point: [0.8, 0, 0], normal: [1, 0, 0] }, NOON);
    expect(sloppy.rank).toBe(1);
    const best = submitDaily(data, "b", "tb", "Bia", perfect, NOON + 1);
    expect(best.rank).toBe(1);
    expect(best.beat).toBe(1);
    expect(best.score.error).toBeLessThan(1e-6);
    expect(() => submitDaily(data, "b", "tb", "Bia", perfect, NOON + 2)).toThrow(/já jogou/);
    expect(leaderboard(data, "a").map((s) => [s.name, s.you])).toEqual([
      ["Bia", false],
      ["Ana", true],
    ]);
  });

  it("rejects attempts after the day is over", () => {
    const data: DailyData = { date: "2026-11-02", entries: [] };
    expect(() => submitDaily(data, "a", "t", "Ana", { point: [0, 0, 0], normal: [1, 0, 0] }, NOON)).toThrow(/acabou/);
  });
});
