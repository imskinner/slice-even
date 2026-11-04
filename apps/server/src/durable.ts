import { DurableObject } from "cloudflare:workers";
import { LIMITS, REACTIONS, type ClientMessage, type DailyResponse, type ServerMessage } from "./protocol.ts";
import { dailyDate, dailyPuzzle, leaderboard, msUntilNextDaily, standingOf, submitDaily, type DailyData } from "./daily.ts";
import {
  createRoomData,
  currentRound,
  finalizeRound,
  isIdle,
  join,
  nextAlarm,
  publicView,
  RoomError,
  startRound,
  submitCut,
  type RoomData,
} from "./room.ts";
import { addBot, fillPublicTable, planBotCuts, removeBot, runDueBots, type BotLevel } from "./bots.ts";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  DAILY: DurableObjectNamespace<Daily>;
  MATCHMAKER: DurableObjectNamespace<Matchmaker>;
}

const newSeed = () => crypto.randomUUID().replaceAll("-", "");

interface Attachment {
  playerId: string | null;
  /** For rate-limiting reactions and aim updates; survives hibernation with the socket. */
  lastReaction?: number;
  lastAim?: number;
}

/**
 * One instance per room code. Holds the room in memory, saves it to its
 * SQLite-backed storage after every change, and talks to players over
 * hibernatable WebSockets (no duration billing while everyone is idle).
 * The round deadline is an alarm, so rounds close even if nobody is online.
 */
export class Room extends DurableObject<Env> {
  private data: RoomData | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Also runs when waking from hibernation, so state always comes back.
    ctx.blockConcurrencyWhile(async () => {
      this.data = (await ctx.storage.get<RoomData>("room")) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      if (this.data) return new Response("taken", { status: 409 });
      const body = (await request.json()) as { code: string; totalRounds: number; public?: boolean };
      try {
        this.data = createRoomData(body.code, body.totalRounds, Date.now(), body.public === true);
      } catch (e) {
        return new Response((e as Error).message, { status: 400 });
      }
      await this.save();
      return new Response("created", { status: 201 });
    }

    // The matchmaker asks whether this public table can still take people.
    if (url.pathname === "/info") {
      const d = this.data;
      return Response.json({
        open: !!d && d.status === "lobby" && d.players.length < 6 && (!d.autoStartAt || d.autoStartAt - Date.now() > 3000),
      });
    }

    if (request.headers.get("Upgrade") === "websocket") {
      const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ playerId: null } satisfies Attachment);
      if (!this.data) {
        this.send(server, { type: "fatal", message: "Sala não encontrada." });
        server.close(4404, "not found");
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.data || typeof raw !== "string") return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    const attachment = ws.deserializeAttachment() as Attachment;
    const now = Date.now();

    try {
      switch (msg.type) {
        case "ping":
          this.send(ws, { type: "pong" });
          return;
        case "react": {
          const player = this.data.players.find((p) => p.id === attachment.playerId);
          if (!player || !(REACTIONS as readonly string[]).includes(msg.emoji)) return;
          if (now - (attachment.lastReaction ?? 0) < LIMITS.reactionGapMs) return;
          ws.serializeAttachment({ ...attachment, lastReaction: now } satisfies Attachment);
          const relay: ServerMessage = { type: "reaction", from: player.id, name: player.name, emoji: msg.emoji };
          for (const other of this.ctx.getWebSockets()) this.send(other, relay);
          return;
        }
        case "aim": {
          // Ghost knives: relay to everyone else, a dozen times a second at most.
          if (!attachment.playerId || now - (attachment.lastAim ?? 0) < LIMITS.aimGapMs) return;
          const [x, z, angle] = [Number(msg.x), Number(msg.z), Number(msg.angle)];
          if (![x, z, angle].every(Number.isFinite) || Math.abs(x) > 30 || Math.abs(z) > 30) return;
          ws.serializeAttachment({ ...attachment, lastAim: now } satisfies Attachment);
          const relay: ServerMessage = { type: "aim", from: attachment.playerId, x, z, angle };
          for (const other of this.ctx.getWebSockets()) if (other !== ws) this.send(other, relay);
          return;
        }
        case "addBot": {
          if (!attachment.playerId) return;
          addBot(this.data, attachment.playerId, msg.level as BotLevel, now, Math.random);
          break;
        }
        case "removeBot": {
          if (!attachment.playerId) return;
          removeBot(this.data, attachment.playerId, String(msg.playerId));
          break;
        }
        case "join": {
          try {
            join(this.data, String(msg.playerId), String(msg.token), String(msg.name ?? ""), now);
          } catch (e) {
            if (!(e instanceof RoomError)) throw e;
            this.send(ws, { type: "fatal", message: e.message });
            ws.close(4403, "rejected");
            return;
          }
          ws.serializeAttachment({ playerId: msg.playerId } satisfies Attachment);
          break;
        }
        case "start": {
          if (!attachment.playerId) return;
          const round = startRound(this.data, attachment.playerId, now, newSeed(), Math.random);
          planBotCuts(this.data, round, Math.random);
          break;
        }
        case "cut": {
          if (!attachment.playerId) return;
          try {
            const score = submitCut(this.data, attachment.playerId, Number(msg.round), msg.plane, now);
            this.send(ws, { type: "cutResult", requestId: msg.requestId, score });
          } catch (e) {
            if (!(e instanceof RoomError)) throw e;
            this.send(ws, { type: "error", requestId: msg.requestId, message: e.message });
            return;
          }
          break;
        }
        default:
          return;
      }
    } catch (e) {
      if (!(e instanceof RoomError)) {
        console.error(e);
        this.send(ws, { type: "error", message: "Erro no servidor." });
        return;
      }
      this.send(ws, { type: "error", message: e.message });
      return;
    }

    await this.save();
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket, code: number) {
    // Tell the others this player went offline (their socket is gone now).
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {
      // Already closed.
    }
    this.broadcast();
  }

  async webSocketError() {
    this.broadcast();
  }

  async alarm() {
    if (!this.data) return;
    const now = Date.now();
    if (isIdle(this.data, now) && this.ctx.getWebSockets().length === 0) {
      // Nobody has touched this room for a long time: free the storage.
      await this.ctx.storage.deleteAll();
      this.data = null;
      return;
    }
    runDueBots(this.data, now, Math.random);
    finalizeRound(this.data, now);
    const round = currentRound(this.data);
    const publicStart = this.data.status === "lobby" && this.data.autoStartAt !== null && now >= this.data.autoStartAt;
    const nextRound = round?.status === "scored" && round.nextStartAt !== null && now >= round.nextStartAt;
    if (publicStart || nextRound) {
      // Public tables top up with bots so nobody plays alone.
      if (publicStart) fillPublicTable(this.data, now, Math.random);
      planBotCuts(this.data, startRound(this.data, null, now, newSeed(), Math.random), Math.random);
    }
    await this.save();
    this.broadcast();
  }

  private async save() {
    if (!this.data) return;
    await this.ctx.storage.put("room", this.data);
    await this.ctx.storage.setAlarm(nextAlarm(this.data));
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket closing; it will be cleaned up.
    }
  }

  /** Sends each connected player their own view of the room. */
  private broadcast() {
    if (!this.data) return;
    const sockets = this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
    const online = new Set(
      sockets.map((ws) => (ws.deserializeAttachment() as Attachment).playerId).filter((id): id is string => !!id),
    );
    const serverTime = Date.now();
    for (const ws of sockets) {
      const { playerId } = ws.deserializeAttachment() as Attachment;
      if (!playerId) continue;
      this.send(ws, { type: "state", state: publicView(this.data, playerId, online), you: playerId, serverTime });
    }
  }
}

/**
 * One instance per UTC date: that day's challenge entries and leaderboard.
 * Plain request/response; no sockets needed.
 */
export class Daily extends DurableObject<Env> {
  private data: DailyData | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.data = (await ctx.storage.get<DailyData>("daily")) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? dailyDate(Date.now());
    this.data ??= { date, entries: [] };
    const data = this.data;
    const now = Date.now();

    const respond = (playerId: string, status = 200) => {
      const mine = standingOf(data, playerId);
      const entry = data.entries.find((e) => e.playerId === playerId);
      const body: DailyResponse = {
        puzzle: dailyPuzzle(data.date),
        leaderboard: leaderboard(data, playerId),
        total: data.entries.length,
        mine: mine && { ...mine, plane: entry?.plane },
        nextInMs: msUntilNextDaily(now),
      };
      return Response.json(body, { status });
    };

    if (request.method === "GET") return respond(url.searchParams.get("player") ?? "");

    if (request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        playerId?: string;
        token?: string;
        name?: string;
        plane?: unknown;
      };
      try {
        submitDaily(data, String(body.playerId ?? ""), String(body.token ?? ""), String(body.name ?? ""), body.plane, now);
      } catch (e) {
        if (!(e instanceof RoomError)) throw e;
        return Response.json({ error: e.message }, { status: 409 });
      }
      await this.ctx.storage.put("daily", data);
      return respond(String(body.playerId), 201);
    }
    return new Response("method not allowed", { status: 405 });
  }
}

/**
 * Single instance that hands out the current public table for "Quick play":
 * the same room while it still has room and time, a new one otherwise.
 */
export class Matchmaker extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    const current = await this.ctx.storage.get<string>("code");
    if (current) {
      const info = await this.env.ROOMS.get(this.env.ROOMS.idFromName(current)).fetch("https://room/info");
      const { open } = (await info.json()) as { open: boolean };
      if (open) return Response.json({ code: current });
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomRoomCode();
      const res = await this.env.ROOMS.get(this.env.ROOMS.idFromName(code)).fetch("https://room/init", {
        method: "POST",
        body: JSON.stringify({ code, totalRounds: 5, public: true }),
      });
      if (res.status === 201) {
        await this.ctx.storage.put("code", code);
        return Response.json({ code });
      }
    }
    return Response.json({ error: "Não foi possível abrir uma mesa." }, { status: 503 });
  }
}

// No 0/O, 1/I/L: codes are read aloud.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
