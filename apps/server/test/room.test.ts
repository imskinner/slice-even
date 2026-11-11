import { describe, expect, it } from "vitest";
import { findBisectingPlane, findPlaneAtFraction, generateObject, objectSeed } from "@slice-even/core";
import {
  createRoomData,
  cutPoints,
  finalizeRound,
  join,
  nextAlarm,
  pickRule,
  placementPoints,
  publicView,
  rematch,
  revealDuration,
  RoomError,
  startRound,
  submitCut,
  type RoomData,
} from "../src/room.ts";
import { LIMITS, revealSchedule } from "../src/protocol.ts";

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
    // Round 1: a star is worth 1. Ana's perfect cut is three stars plus the winner's bonus.
    const brunoError = data.cuts.find((c) => c.playerId === "bruno")!.error;
    expect(data.rounds[0]!.points).toEqual({ ana: 4, bruno: cutPoints(1, 1, brunoError) });
    expect(data.players.find((p) => p.id === "ana")!.score).toBe(4);
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
  it("the podium bonus is N to the winner, half to second, a quarter to third", () => {
    expect([0, 1, 2, 3].map((p) => placementPoints(8, p))).toEqual([8, 4, 2, 0]);
    expect([0, 1, 2].map((p) => placementPoints(1, p))).toEqual([1, 0, 0]);
  });

  it("everyone scores by precision: up to three stars, each worth the round number", () => {
    // Fifth place, no bonus: 3, 2, 1 or 0 stars at 4 points each.
    expect([0.019, 0.02, 0.049, 0.05, 0.099, 0.1, 1].map((e) => cutPoints(4, 4, e))).toEqual([12, 8, 8, 4, 4, 0, 0]);
    // The winner's bonus comes on top, whatever the cut was like.
    expect(cutPoints(4, 0, 0.001)).toBe(16);
    expect(cutPoints(4, 0, 0.3)).toBe(4);
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

describe("reveal", () => {
  it("drum-rolls only the podium, so a full table takes about as long as a small one", () => {
    const eight = revealSchedule(8);
    expect(eight.steps.map((s) => s.roll)).toEqual([false, false, false, false, false, true, true, true]);
    expect(eight.steps.at(-1)!.at).toBe(eight.total);
    expect(eight.total).toBeLessThan(6500);
    expect(revealSchedule(2).steps.every((s) => s.roll)).toBe(true);
    expect(revealDuration(8) - revealDuration(3)).toBeLessThan(2000);
  });
});

describe("rematch", () => {
  function finished(): RoomData {
    const data = lobby(["ana", "bruno", "carla"]);
    for (let n = 1; n <= 3; n++) {
      startRound(data, "ana", T0 + n, `s${n}`, fixed);
      for (const id of ["ana", "bruno", "carla"]) submitCut(data, id, n, perfectPlane(data, id), T0 + n);
    }
    return data;
  }

  it("only after the game is over, and only for someone in the room", () => {
    const data = lobby();
    expect(() => rematch(data, "ana", T0, new Set(["ana"]))).toThrow(/não acabou/);
    expect(() => rematch(finished(), "nobody", T0, new Set())).toThrow(/não está/);
  });

  it("goes back to the lobby with scores cleared and new round ids", () => {
    const data = finished();
    expect(data.status).toBe("finished");
    const before = publicView(data, "ana", new Set()).rounds[0]!.id;
    expect(publicView(data, "ana", new Set()).rounds[0]!.scored_at).not.toBeNull();

    rematch(data, "bruno", T0 + 100, new Set(["ana", "bruno", "carla"]));
    expect(data.status).toBe("lobby");
    expect(data.rounds).toEqual([]);
    expect(data.cuts).toEqual([]);
    expect(data.players.map((p) => [p.id, p.score, p.wins, p.lastCutRound])).toEqual([
      ["ana", 0, 0, 0],
      ["bruno", 0, 0, 0],
      ["carla", 0, 0, 0],
    ]);
    expect(data.hostId).toBe("ana");

    startRound(data, "ana", T0 + 200, "again", fixed);
    expect(publicView(data, "ana", new Set()).rounds[0]!.id).not.toBe(before);
  });

  it("drops people who left and hands the room to whoever asked if the host is gone", () => {
    const data = finished();
    rematch(data, "carla", T0 + 100, new Set(["bruno", "carla"]));
    expect(data.players.map((p) => p.id)).toEqual(["bruno", "carla"]);
    expect(data.hostId).toBe("carla");
  });
});
