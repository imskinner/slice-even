import { randomRoomCode, type Env } from "./durable.ts";
import { dailyDate } from "./daily.ts";

export { Room, Daily, Matchmaker } from "./durable.ts";

/**
 * HTTP entry point:
 *   POST /api/rooms            { totalRounds }  ->  { code }
 *   POST /api/quickplay        ->  { code } of the open public table
 *   GET  /api/rooms/:code/ws   WebSocket to that room's Durable Object
 *   GET  /api/daily?player=id   today's challenge, leaderboard, your result
 *   POST /api/daily             { playerId, token, name, plane }: your one attempt
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const CODE = /^[A-HJ-NP-Z2-9]{5}$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { totalRounds?: number };
      const totalRounds = Number(body.totalRounds ?? 5);
      // The room's Durable Object is addressed by its code; retry on the rare collision.
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = randomRoomCode();
        const room = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await room.fetch("https://room/init", {
          method: "POST",
          body: JSON.stringify({ code, totalRounds }),
        });
        if (res.status === 201) return json(201, { code });
        if (res.status !== 409) return json(res.status, { error: await res.text() });
      }
      return json(503, { error: "Não foi possível criar a sala, tente de novo." });
    }

    if (url.pathname === "/api/quickplay" && request.method === "POST") {
      const res = await env.MATCHMAKER.get(env.MATCHMAKER.idFromName("global")).fetch(request.url, { method: "POST" });
      return new Response(res.body, { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const ws = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (ws) {
      const code = decodeURIComponent(ws[1]!).toUpperCase();
      if (!CODE.test(code)) return json(400, { error: "Código inválido." });
      if (request.headers.get("Upgrade") !== "websocket") return json(426, { error: "Expected WebSocket" });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }

    if (url.pathname === "/api/daily" && (request.method === "GET" || request.method === "POST")) {
      // Each UTC day has its own Durable Object.
      const date = dailyDate(Date.now());
      const target = new URL(request.url);
      target.searchParams.set("date", date);
      const res = await env.DAILY.get(env.DAILY.idFromName(date)).fetch(new Request(target, request));
      return new Response(res.body, { status: res.status, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/api/health") return json(200, { ok: true });
    return json(404, { error: "not found" });
  },
} satisfies ExportedHandler<Env>;
