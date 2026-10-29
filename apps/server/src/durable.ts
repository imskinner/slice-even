import { DurableObject } from "cloudflare:workers";
import type { ClientMessage, ServerMessage } from "./protocol.ts";
import {
  createRoomData,
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

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

interface Attachment {
  playerId: string | null;
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
      const { code, totalRounds } = (await request.json()) as { code: string; totalRounds: number };
      try {
        this.data = createRoomData(code, totalRounds, Date.now());
      } catch (e) {
        return new Response((e as Error).message, { status: 400 });
      }
      await this.save();
      return new Response("created", { status: 201 });
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
          startRound(this.data, attachment.playerId, now, crypto.randomUUID().replaceAll("-", ""), Math.random);
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
    finalizeRound(this.data, now);
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
