import { describe, expect, it } from "vitest";
import {
  addBot,
  BOT_HURRY_MS,
  BOT_SKILL,
  fillPublicTable,
  hurryBots,
  planBotCuts,
  PUBLIC_TABLE_SIZE,
  removeBot,
  runDueBots,
} from "../src/bots.ts";
import { createRoomData, join, nextAlarm, PUBLIC_COUNTDOWN_MS, startRound, submitCut } from "../src/room.ts";

const T0 = 1_700_000_000_000;

/** Deterministic pseudo-random sequence for repeatable bots. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe("bots", () => {
  it("only the host adds them, and they get bot names", () => {
    const data = createRoomData("ABCDE", 3, T0);
    join(data, "ana", "t", "Ana", T0);
    join(data, "bia", "t", "Bia", T0);
    expect(() => addBot(data, "bia", "easy", T0, seeded())).toThrow(/criou a sala/);
    const bot = addBot(data, "ana", "hard", T0, seeded());
    expect(bot.name.startsWith("🤖")).toBe(true);
    expect(bot.bot).toEqual({ level: "hard" });
    removeBot(data, "ana", bot.id);
    expect(data.players).toHaveLength(2);
  });

  it("stop making people wait: once every person has cut, they cut within moments", () => {
    const random = seeded(3);
    const data = createRoomData("ABCDE", 3, T0);
    join(data, "ana", "t", "Ana", T0);
    join(data, "bia", "t", "Bia", T0);
    addBot(data, "ana", "easy", T0, random);
    addBot(data, "ana", "hard", T0, random);
    const round = startRound(data, "ana", T0, "seed", random);
    planBotCuts(data, round, random);
    const planned = round.botPlans.map((p) => p.at);
    const plane = { point: [0, 0, 0], normal: [1, 0, 0] };

    // Bia is still aiming: the bots keep their own pace.
    submitCut(data, "ana", 1, plane, T0 + 1000);
    expect(hurryBots(data, T0 + 1000, random)).toBe(false);
    expect(round.botPlans.map((p) => p.at)).toEqual(planned);

    submitCut(data, "bia", 1, plane, T0 + 2000);
    expect(hurryBots(data, T0 + 2000, random)).toBe(true);
    for (const plan of round.botPlans) {
      expect(plan.at).toBeGreaterThanOrEqual(T0 + 2000 + BOT_HURRY_MS.min);
      expect(plan.at).toBeLessThanOrEqual(T0 + 2000 + BOT_HURRY_MS.max);
    }
    expect(nextAlarm(data)).toBeLessThanOrEqual(T0 + 2000 + BOT_HURRY_MS.max);

    runDueBots(data, T0 + 2000 + BOT_HURRY_MS.max, random);
    expect(round.status).toBe("scored");
  });

  it("cut on their own during the round, close it, and hit near their skill", () => {
    const random = seeded(7);
    const data = createRoomData("ABCDE", 3, T0);
    join(data, "ana", "t", "Ana", T0);
    const bots = [addBot(data, "ana", "hard", T0, random), addBot(data, "ana", "medium", T0, random)];
    const round = startRound(data, "ana", T0, "seed", random);
    planBotCuts(data, round, random);
    expect(round.botPlans).toHaveLength(2);
    for (const plan of round.botPlans) {
      expect(plan.at).toBeGreaterThan(round.startedAt);
      expect(plan.at).toBeLessThan(round.deadline);
    }
    expect(nextAlarm(data)).toBe(Math.min(...round.botPlans.map((p) => p.at)));

    expect(runDueBots(data, T0 + 1, random)).toBe(false);
    expect(runDueBots(data, round.deadline - 1, random)).toBe(true);
    const botCuts = data.cuts.filter((c) => bots.some((b) => b.id === c.playerId));
    expect(botCuts).toHaveLength(2);
    // Errors are |gaussian| × skill: comfortably under five times the skill.
    for (const cut of botCuts) {
      const bot = bots.find((b) => b.id === cut.playerId)!;
      expect(cut.error).toBeLessThan(BOT_SKILL[bot.bot!.level] * 5);
    }
    // The human has not cut, so the round is still open.
    expect(round.status).toBe("cutting");
  });

  it("public tables start after a countdown and fill empty seats with bots", () => {
    const random = seeded(3);
    const data = createRoomData("PUBLC", 5, T0, true);
    join(data, "ana", "t", "Ana", T0);
    expect(data.autoStartAt).toBe(T0 + PUBLIC_COUNTDOWN_MS);
    expect(nextAlarm(data)).toBe(T0 + PUBLIC_COUNTDOWN_MS);
    expect(() => startRound(data, null, T0 + 1000, "s", random)).toThrow(/hora/);

    fillPublicTable(data, data.autoStartAt!, random);
    expect(data.players).toHaveLength(PUBLIC_TABLE_SIZE);
    const round = startRound(data, null, data.autoStartAt!, "s", random);
    expect(round.participants).toHaveLength(PUBLIC_TABLE_SIZE);
    expect(data.autoStartAt).toBeNull();
  });
});
