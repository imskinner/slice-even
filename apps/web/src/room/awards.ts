import type { Cut, Player, Round } from "../net/rooms.ts";

export interface Award {
  emoji: string;
  title: string;
  playerId: string;
  /** What earned it, e.g. "0,3% na rodada 2". */
  detail: string;
}

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/**
 * End-of-game superlatives, so more than the champion gets a mention:
 * the best single cut, the steadiest hand, the biggest climb in the second
 * half and (all in good fun) the worst cut. At most three are returned.
 */
export function matchAwards(players: Player[], rounds: Round[], cuts: Cut[]): Award[] {
  const roundNumber = new Map(rounds.map((r) => [r.id, r.number]));
  const known = cuts.filter((c) => roundNumber.has(c.round_id) && players.some((p) => p.user_id === c.user_id));
  // A miss (error 1) is not a "cut" worth an award either way.
  const real = known.filter((c) => c.error < 1);
  const awards: Award[] = [];
  if (!real.length || players.length < 2) return awards;

  const best = real.reduce((a, b) => (b.error < a.error ? b : a));
  awards.push({
    emoji: "✨",
    title: "Corte da partida",
    playerId: best.user_id,
    detail: `${pct(best.error)} na rodada ${roundNumber.get(best.round_id)}`,
  });

  // Steadiest: lowest average over at least half the rounds (a miss or no-show counts as 100%).
  const enough = Math.ceil(rounds.length / 2);
  const averages = players
    .map((p) => {
      const played = rounds.filter((r) => r.participants.includes(p.user_id));
      const total = played.reduce(
        (sum, r) => sum + (known.find((c) => c.round_id === r.id && c.user_id === p.user_id)?.error ?? 1),
        0,
      );
      return { id: p.user_id, rounds: played.length, mean: played.length ? total / played.length : 1 };
    })
    .filter((a) => a.rounds >= enough)
    .sort((a, b) => a.mean - b.mean);
  if (rounds.length >= 2 && averages[0] && averages[0].mean < 1) {
    awards.push({ emoji: "🎯", title: "Mão mais firme", playerId: averages[0].id, detail: `média de ${pct(averages[0].mean)}` });
  }

  // Comeback: places gained between the halfway standings and the final ones.
  if (rounds.length >= 3) {
    const half = Math.floor(rounds.length / 2);
    const scoreAfter = (id: string, upTo: number) =>
      rounds.filter((r) => r.number <= upTo).reduce((sum, r) => sum + (r.points[id] ?? 0), 0);
    const rankAt = (upTo: number) => {
      const order = [...players].sort((a, b) => scoreAfter(b.user_id, upTo) - scoreAfter(a.user_id, upTo));
      return new Map(order.map((p, i) => [p.user_id, i + 1]));
    };
    const [mid, end] = [rankAt(half), rankAt(rounds.length)];
    const climb = players
      .map((p) => ({ id: p.user_id, from: mid.get(p.user_id)!, to: end.get(p.user_id)! }))
      .sort((a, b) => b.from - b.to - (a.from - a.to))[0];
    if (climb && climb.from - climb.to >= 2) {
      awards.push({ emoji: "📈", title: "Maior virada", playerId: climb.id, detail: `do ${climb.from}º ao ${climb.to}º lugar` });
    }
  }

  const worst = real.reduce((a, b) => (b.error > a.error ? b : a));
  if (awards.length < 3 && worst.error >= 0.1 && worst !== best) {
    awards.push({
      emoji: "🤏",
      title: "Lasquinha",
      playerId: worst.user_id,
      detail: `${pct(worst.error)} na rodada ${roundNumber.get(worst.round_id)}`,
    });
  }
  return awards.slice(0, 3);
}
