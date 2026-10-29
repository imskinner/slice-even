import type { Env } from "./durable.ts";

export { Room } from "./durable.ts";

/**
 * HTTP entry point:
 *   POST /api/rooms            { totalRounds }  ->  { code }
 *   GET  /api/rooms/:code/ws   WebSocket to that room's Durable Object
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

// No 0/O, 1/I/L: codes are read aloud.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE = /^[A-HJ-NP-Z2-9]{5}$/;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

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
        const code = randomCode();
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

    const ws = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (ws) {
      const code = decodeURIComponent(ws[1]!).toUpperCase();
      if (!CODE.test(code)) return json(400, { error: "Código inválido." });
      if (request.headers.get("Upgrade") !== "websocket") return json(426, { error: "Expected WebSocket" });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }

    if (url.pathname === "/api/health") return json(200, { ok: true });
    return json(404, { error: "not found" });
  },
} satisfies ExportedHandler<Env>;
