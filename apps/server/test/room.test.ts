import { describe, expect, it } from "vitest";
import { findBisectingPlane, generateObject, playerSeed } from "@slice-even/core";
import {
  createRoomData,
  finalizeRound,
  join,
  nextAlarm,
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
  const object = generateObject(round.kind, playerSeed(round.seed, playerId));
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

    const started = lobby();
    startRound(started, "ana", T0, "seed1", fixed);
    expect(() => join(started, "carla", "t", "Carla", T0)).toThrow(/começou/);
    // But a player who was already in can come back.
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
