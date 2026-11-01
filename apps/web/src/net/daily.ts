import type { Plane } from "@slice-even/core";
import type { DailyResponse } from "@slice-even/server/protocol";

export type { DailyResponse } from "@slice-even/server/protocol";

const SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, "");

interface Identity {
  playerId: string;
  token: string;
}

const KEY = "slice-even:player";
let memory: Identity | null = null;

/**
 * Unlike rooms (one player per tab), the daily challenge needs the same
 * identity across visits so "one attempt per day" and streaks hold.
 */
function persistentIdentity(): Identity {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return JSON.parse(saved) as Identity;
    const fresh = { playerId: crypto.randomUUID(), token: crypto.randomUUID() };
    localStorage.setItem(KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    memory ??= { playerId: crypto.randomUUID(), token: crypto.randomUUID() };
    return memory;
  }
}

async function call(init?: RequestInit): Promise<DailyResponse> {
  if (!SERVER) throw new Error("Servidor não configurado.");
  const { playerId } = persistentIdentity();
  const res = await fetch(`${SERVER}/api/daily?player=${encodeURIComponent(playerId)}`, init).catch(() => null);
  if (!res) throw new Error("Não foi possível falar com o servidor.");
  const body = (await res.json().catch(() => ({}))) as DailyResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Erro no servidor.");
  return body;
}

export const fetchDaily = () => call();

export function submitDaily(name: string, plane: Plane): Promise<DailyResponse> {
  const { playerId, token } = persistentIdentity();
  return call({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId, token, name, plane }),
  });
}

/* ------------------------------------------------------------ streak */

const STREAK_KEY = "slice-even:streak";

interface Streak {
  last: string;
  count: number;
}

/** Consecutive days played, counted locally when a daily result comes in. */
export function recordStreak(date: string): number {
  try {
    const saved = JSON.parse(localStorage.getItem(STREAK_KEY) ?? "null") as Streak | null;
    if (saved?.last === date) return saved.count;
    const yesterday = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const count = saved?.last === yesterday ? saved.count + 1 : 1;
    localStorage.setItem(STREAK_KEY, JSON.stringify({ last: date, count }));
    return count;
  } catch {
    return 1;
  }
}
