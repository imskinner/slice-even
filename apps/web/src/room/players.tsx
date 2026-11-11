import type { Cut, Player, Round } from "../net/rooms.ts";

/**
 * One color per seat (join order), so nobody at a full table of eight shares
 * a color: it identifies a player's avatar, ghost knife and cut line.
 */
const SEAT_COLORS = ["#ffc93c", "#3fc5f0", "#36d96b", "#ff8a3d", "#ff3e7f", "#b28dff", "#2f6bff", "#8a94a0"];
const FACES = ["🍎", "🍊", "🍌", "🥒", "🥕", "🍅", "🍞", "🎂"];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export function seatColor(players: readonly { user_id: string }[], id: string): string {
  const seat = players.findIndex((p) => p.user_id === id);
  return SEAT_COLORS[Math.max(0, seat) % SEAT_COLORS.length]!;
}

/** The server prefixes bot names with a robot; next to a robot avatar that is noise. */
export function displayName(player: Pick<Player, "name" | "bot">): string {
  return player.bot ? player.name.replace(/^🤖\s*/, "") : player.name;
}

/** Fruit face for people (stable per id), robot for bots, on the seat color. */
export function Avatar({ player, color, big = false }: { player: Pick<Player, "user_id" | "bot">; color: string; big?: boolean }) {
  return (
    <span className={big ? "avatar big" : "avatar"} style={{ background: color }} aria-hidden>
      {player.bot ? "🤖" : FACES[(hashId(player.user_id) >>> 8) % FACES.length]}
    </span>
  );
}

/**
 * The game standings after round `upTo` (default: now): points, then round
 * wins, then the lower average error, so players level on points (everyone
 * on zero after round 1, say) are still listed best cutter first. Every
 * screen ranks with this, so they all agree on who the champion is.
 */
export function rankPlayers<T extends Pick<Player, "user_id">>(
  players: readonly T[],
  rounds: readonly Round[],
  cuts: readonly Cut[],
  upTo = Infinity,
): T[] {
  const scored = rounds.filter((r) => r.status === "scored" && r.number <= upTo);
  const stats = new Map(
    players.map((p) => {
      const played = scored.filter((r) => r.participants.includes(p.user_id));
      // A no-show weighs like a miss.
      const error = played.reduce(
        (sum, r) => sum + (cuts.find((c) => c.round_id === r.id && c.user_id === p.user_id)?.error ?? 1),
        0,
      );
      return [
        p.user_id,
        {
          score: scored.reduce((sum, r) => sum + (r.points[p.user_id] ?? 0), 0),
          wins: scored.filter((r) => r.winner_id === p.user_id).length,
          error: played.length ? error / played.length : 1,
        },
      ] as const;
    }),
  );
  return [...players].sort((a, b) => {
    const [x, y] = [stats.get(a.user_id)!, stats.get(b.user_id)!];
    return y.score - x.score || y.wins - x.wins || x.error - y.error;
  });
}
