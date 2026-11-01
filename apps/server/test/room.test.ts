import { describe, expect, it } from "vitest";
import { findBisectingPlane, findPlaneAtFraction, generateObject, objectSeed } from "@slice-even/core";
import {
  createRoomData,
  finalizeRound,
  join,
  nextAlarm,
  pickRule,
  placementPoints,
  publicView,
  RoomError,
  startRound,
  submitCut,
  type RoomData,
} from "../src/room.ts";
import { LIMITS } from "../src/protocol.ts";

const T0 = 1_700_000_000_000;
const fixed = () => 0.1; // always the first kind: apple

function lobby(players = ["ana", "bruno"]): RoomData {
  const data = createRoomData("ABCDE", 3, T0);
  for (const id of players) join(data, id, `${id}-token`, id.toUpperCase(), T0);
  return data;
}

/** The cut that splits this player's object exactly in half. */
function perfectPlane(data: RoomData, playerId: string) {
  const round = data.rounds.at(-1)!;
  const object = generateObject(round.kind, objectSeed(round.seed, playerId, round.rule));
  return findBisectingPlane(object.mesh, [1, 0, 0]);
}

describe("joining", () => {
  it("makes the first player host and remembers everyone", () => {
    const data = lobby();
    expect(data.hostId).toBe("ana");
    expect(data.players.map((p) => p.name)).toEqual(["ANA", "BRUNO"]);
  });

  it("lets a player reconnect only with the same token", () => {
    const data = lobby();
    expect(() => join(data, "ana", "ana-token", "Ana 2", T0)).not.toThrow();
    expect(data.players[0]!.name).toBe("Ana 2");
    expect(() => join(data, "ana", "stolen", "Impostor", T0)).toThrow(RoomError);
  });

  it("rejects bad names, full rooms and late joiners", () => {
    const data = lobby([]);
    expect(() => join(data, "x", "t", "   ", T0)).toThrow(RoomError);
    expect(() => join(data, "x", "t", "a".repeat(LIMITS.maxName + 1), T0)).toThrow(RoomError);
    for (let i = 0; i < LIMITS.maxPlayers; i++) join(data, `p${i}`, "t", `P${i}`, T0);
    expect(() => join(data, "late", "t", "Late", T0)).toThrow(/cheia/);

    // Mid-game newcomers join and play from the next round.
    const started = lobby();
    startRound(started, "ana", T0, "seed1", fixed);
    join(started, "carla", "t", "Carla", T0);
    expect(started.rounds[0]!.participants).not.toContain("carla");
    expect(() => submitCut(started, "carla", 1, { point: [0, 0, 0], normal: [1, 0, 0] }, T0)).toThrow(/próxima/);
    expect(() => join(started, "bruno", "bruno-token", "Bruno", T0)).not.toThrow();
  });
});

describe("rounds", () => {
  it("only the host starts, one round at a time", () => {
    const data = lobby();
    expect(() => startRound(data, "bruno", T0, "s", fixed)).toThrow(/criou a sala/);
    const round = startRound(data, "ana", T0, "s", fixed);
    expect(round.kind).toBe("apple");
    expect(data.status).toBe("playing");
    expect(() => startRound(data, "ana", T0, "s2", fixed)).toThrow(/ainda não terminou/);
  });

  it("scores on the server and closes when everyone has cut", () => {
    const data = lobby();
    startRound(data, "ana", T0, "seed-r1", fixed);
    const anaScore = submitCut(data, "ana", 1, perfectPlane(data, "ana"), T0 + 5000);
    expect(anaScore.error).toBeLessThan(1e-6);
    expect(data.rounds[0]!.status).toBe("cutting");

    submitCut(data, "bruno", 1, { point: [0.5, 0, 0], normal: [1, 0, 0] }, T0 + 6000);
    expect(data.rounds[0]!.status).toBe("scored");
    expect(data.rounds[0]!.winnerId).toBe("ana");
    expect(data.players.find((p) => p.id === "ana")!.wins).toBe(1);
    // Round 1 is worth 1 point, plus the precision bonus for a perfect cut.
    expect(data.rounds[0]!.points).toEqual({ ana: 2, bruno: 0 });
    expect(data.players.find((p) => p.id === "ana")!.score).toBe(2);
  });

  it("rejects double cuts, wrong rounds, tilted knives and late cuts", () => {
    const data = lobby();
    startRound(data, "ana", T0, "s", fixed);
    const plane = { point: [0, 0, 0], normal: [1, 0, 0] };
    expect(() => submitCut(data, "ana", 2, plane, T0)).toThrow(/acabou/);
    expect(() => submitCut(data, "ana", 1, { point: [0, 0, 0], normal: [1, 1, 0] }, T0)).toThrow(/inválido/);
    submitCut(data, "ana", 1, plane, T0);
    expect(() => submitCut(data, "ana", 1, plane, T0)).toThrow(/já cortou/);
    const deadline = data.rounds[0]!.deadline;
    expect(() => submitCut(data, "bruno", 1, plane, deadline + 1)).toThrow(/tempo/);
    expect(() => submitCut(data, "nobody", 1, plane, T0)).toThrow(/não está/);
  });

  it("times out: missing players lose, the round closes at the deadline", () => {
    const data = lobby();
    startRound(data, "ana", T0, "s", fixed);
    submitCut(data, "bruno", 1, { point: [0, 0, 0], normal: [1, 0, 0] }, T0 + 1000);
    expect(finalizeRound(data, T0 + 2000)).toBe(false);
    expect(nextAlarm(data)).toBe(data.rounds[0]!.deadline);
    expect(finalizeRound(data, data.rounds[0]!.deadline)).toBe(true);
    expect(data.rounds[0]!.winnerId).toBe("bruno");
  });

  it("finishes after the last round", () => {
    const data = lobby(["solo"]);
    for (let n = 1; n <= 3; n++) {
      startRound(data, "solo", T0 + n, `s${n}`, fixed);
      submitCut(data, "solo", n, { point: [0, 0, 0], normal: [1, 0, 0] }, T0 + n);
    }
    expect(data.status).toBe("finished");
    expect(() => startRound(data, "solo", T0 + 10, "s4", fixed)).toThrow(/acabou/);
  });
});

describe("publicView", () => {
  it("hides other players' cuts until the round is scored, and never leaks tokens", () => {
    const data = lobby();
    startRound(data, "ana", T0, "s", fixed);
    submitCut(data, "ana", 1, { point: [0, 0, 0], normal: [1, 0, 0] }, T0);

    const forAna = publicView(data, "ana", new Set(["ana"]));
    const forBruno = publicView(data, "bruno", new Set());
    expect(forAna.cuts).toHaveLength(1);
    expect(forBruno.cuts).toHaveLength(0);
    expect(forBruno.players.find((p) => p.user_id === "ana")!.last_cut_round).toBe(1);
    expect(forAna.players.find((p) => p.user_id === "ana")!.online).toBe(true);
    expect(JSON.stringify(forAna)).not.toContain("token");

    submitCut(data, "bruno", 1, { point: [0, 0, 0], normal: [1, 0, 0] }, T0);
    expect(publicView(data, "bruno", new Set()).cuts).toHaveLength(2);
  });
});

describe("show rules", () => {
  it("round N is worth N to the winner, half to second, a quarter to third", () => {
    expect([0, 1, 2, 3].map((p) => placementPoints(8, p))).toEqual([8, 4, 2, 0]);
    expect([0, 1, 2].map((p) => placementPoints(1, p))).toEqual([1, 0, 0]);
  });

  it("opens classic, ends head-to-head, and varies in between", () => {
    expect(pickRule(1, 5, Math.random)).toEqual({ type: "classic" });
    expect(pickRule(5, 5, Math.random)).toEqual({ type: "twin" });
    const seen = new Set<string>();
    let x = 0;
    const sweep = () => (x = (x + 0.137) % 1);
    for (let i = 0; i < 200; i++) seen.add(pickRule(3, 5, sweep).type);
    expect([...seen].sort()).toEqual(["blind", "blitz", "classic", "target", "twin"]);
  });

  it("twin rounds give everyone the same object", () => {
    const data = lobby();
    const round = startRound(data, "ana", T0, "s", fixed);
    round.rule = { type: "twin" };
    const a = generateObject(round.kind, objectSeed(round.seed, "ana", round.rule));
    const b = generateObject(round.kind, objectSeed(round.seed, "bruno", round.rule));
    expect(a.mesh.positions).toEqual(b.mesh.positions);
  });

  it("target rounds score against the target, either side", () => {
    const data = lobby(["solo"]);
    const round = startRound(data, "solo", T0, "s", fixed);
    round.rule = { type: "target", target: 0.3 };
    const object = generateObject(round.kind, objectSeed(round.seed, "solo", round.rule));
    const plane = findPlaneAtFraction(object.mesh, [1, 0, 0], 0.7);
    expect(submitCut(data, "solo", 1, plane, T0).error).toBeLessThan(1e-6);
  });

  it("starts the next round on its own after the reveal, and the host can skip ahead", () => {
    const data = lobby();
    startRound(data, "ana", T0, "s1", fixed);
    for (const id of ["ana", "bruno"]) submitCut(data, id, 1, { point: [0, 0, 0], normal: [1, 0, 0] }, T0 + 1000);
    const next = data.rounds[0]!.nextStartAt!;
    expect(next).toBeGreaterThan(T0 + 1000);
    expect(nextAlarm(data)).toBe(next);
    expect(() => startRound(data, null, next - 1, "s2", fixed)).toThrow(/hora/);
    expect(startRound(data, null, next, "s2", fixed).number).toBe(2);
    expect(data.rounds[0]!.nextStartAt).toBeNull();
  });

  it("blitz rounds are short", () => {
    const data = lobby();
    startRound(data, "ana", T0, "s", fixed);
    for (const id of ["ana", "bruno"]) submitCut(data, id, 1, { point: [0, 0, 0], normal: [1, 0, 0] }, T0);
    // 0.6 lands on the blitz slice of the roulette (weights 3/3/1.5/1.5/2).
    const second = startRound(data, "ana", T0 + 5000, "s2", () => 0.6);
    expect(second.rule.type).toBe("blitz");
    expect(second.deadline - second.startedAt).toBe(LIMITS.blitzSeconds * 1000 + LIMITS.graceMs);
  });
});
