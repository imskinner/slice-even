import { useCallback, useEffect, useRef, useState } from "react";
import type { CutResult, Plane } from "@slice-even/core";
import type { ClientMessage, RoomState, ServerMessage } from "@slice-even/server/protocol";

export type { Cut, Player, Room, Round, RoomState } from "@slice-even/server/protocol";

/**
 * Multiplayer client: one WebSocket per room to its Durable Object on
 * Cloudflare. The server is the source of truth; this keeps the latest
 * state it sent and offers the two actions a player can take.
 */

const SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, "");

/** Multiplayer needs the server URL; practice mode works without it. */
export const multiplayerConfigured = Boolean(SERVER);

interface Identity {
  playerId: string;
  /** Proves on reconnect that this tab is the same player. */
  token: string;
}

const IDENTITY_KEY = "slice-even:identity";
let memoryIdentity: Identity | null = null;

/**
 * One player per browser tab: reloads keep you in your room, a second tab is
 * a second player (handy for testing).
 */
export function identity(): Identity {
  try {
    const saved = sessionStorage.getItem(IDENTITY_KEY);
    if (saved) return JSON.parse(saved) as Identity;
    const fresh = { playerId: crypto.randomUUID(), token: crypto.randomUUID() };
    sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    memoryIdentity ??= { playerId: crypto.randomUUID(), token: crypto.randomUUID() };
    return memoryIdentity;
  }
}

export async function createRoom(totalRounds: number): Promise<string> {
  if (!SERVER) throw new Error("Servidor multiplayer não configurado.");
  const res = await fetch(`${SERVER}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalRounds }),
  }).catch(() => null);
  if (!res) throw new Error("Não foi possível falar com o servidor.");
  const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
  if (!res.ok || !body.code) throw new Error(body.error ?? "Não foi possível criar a sala.");
  return body.code;
}

/**
 * Server timestamps converted to this device's clock, so countdowns work
 * even when the device clock is off.
 */
function toLocalClock(state: RoomState, offsetMs: number): RoomState {
  const shift = (iso: string) => new Date(new Date(iso).getTime() - offsetMs).toISOString();
  return {
    ...state,
    rounds: state.rounds.map((r) => ({ ...r, started_at: shift(r.started_at), deadline: shift(r.deadline) })),
  };
}

interface PendingCut {
  resolve(score: CutResult): void;
  reject(error: Error): void;
}

export function useRoom(code: string, name: string) {
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<string, PendingCut>());

  useEffect(() => {
    if (!SERVER) {
      setFatal("Servidor multiplayer não configurado.");
      return;
    }
    const { playerId, token } = identity();
    const url = `${SERVER.replace(/^http/, "ws")}/api/rooms/${encodeURIComponent(code)}/ws`;
    let stopped = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const ws = new WebSocket(url);
      socket.current = ws;
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        ws.send(JSON.stringify({ type: "join", playerId, token, name } satisfies ClientMessage));
        // Keeps proxies from dropping an idle connection.
        pingTimer = setInterval(() => ws.send(JSON.stringify({ type: "ping" } satisfies ClientMessage)), 25_000);
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        switch (msg.type) {
          case "state":
            setState(toLocalClock(msg.state, msg.serverTime - Date.now()));
            setError(null);
            break;
          case "cutResult":
            pending.current.get(msg.requestId)?.resolve(msg.score);
            pending.current.delete(msg.requestId);
            break;
          case "error":
            if (msg.requestId && pending.current.has(msg.requestId)) {
              pending.current.get(msg.requestId)!.reject(new Error(msg.message));
              pending.current.delete(msg.requestId);
            } else {
              setError(msg.message);
            }
            break;
          case "fatal":
            stopped = true;
            setFatal(msg.message);
            break;
        }
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        setConnected(false);
        for (const p of pending.current.values()) p.reject(new Error("Conexão perdida."));
        pending.current.clear();
        if (stopped) return;
        // Back off: 0.5 s, 1 s, 2 s ... up to 8 s.
        retryTimer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      socket.current?.close(1000, "leaving");
      socket.current = null;
    };
  }, [code, name]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("Sem conexão com o servidor.");
    ws.send(JSON.stringify(msg));
  }, []);

  const start = useCallback(() => send({ type: "start" }), [send]);

  /** The server regenerates the object from the seed and scores the plane. */
  const cut = useCallback(
    (round: number, plane: Plane) =>
      new Promise<CutResult>((resolve, reject) => {
        const requestId = crypto.randomUUID();
        pending.current.set(requestId, { resolve, reject });
        try {
          send({ type: "cut", requestId, round, plane });
        } catch (e) {
          pending.current.delete(requestId);
          reject(e as Error);
        }
      }),
    [send],
  );

  return { state, error, fatal, connected, start, cut, playerId: identity().playerId };
}
