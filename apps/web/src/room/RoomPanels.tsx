import { useEffect, useState, type CSSProperties } from "react";
import type { Cut, Player, Room, Round } from "../net/rooms.ts";
import { rateError } from "../game.ts";
import { Balance } from "../ui/Balance.tsx";
import { sfx } from "../audio/sfx.ts";

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** The server deadline includes 2 s of slack for latency; players see the real limit. */
const DEADLINE_SLACK_MS = 2000;

const AVATAR_COLORS = ["#ffc93c", "#3fc5f0", "#36d96b", "#ff8a3d", "#ff3e7f", "#b28dff"];
const AVATAR_FACES = ["🍎", "🍊", "🍌", "🥒", "🥕", "🍅", "🍞", "🎂"];

/** Stable fruit avatar per player id. */
export function Avatar({ id }: { id: string }) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (
    <span className="avatar" style={{ background: AVATAR_COLORS[h % AVATAR_COLORS.length] }}>
      {AVATAR_FACES[(h >>> 8) % AVATAR_FACES.length]}
    </span>
  );
}

export function Lobby({
  room,
  players,
  userId,
  onStart,
}: {
  room: Room;
  players: Player[];
  userId: string;
  onStart(): void;
}) {
  const [copied, setCopied] = useState(false);
  // Pop when someone new arrives.
  const [seen, setSeen] = useState(players.length);
  useEffect(() => {
    if (players.length > seen) sfx.pop();
    setSeen(players.length);
  }, [players.length, seen]);
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  const copy = () => {
    navigator.clipboard?.writeText(link).then(() => setCopied(true), () => undefined);
  };

  return (
    <div className="result panel lobby">
      <div className="lobby-label">Código da sala</div>
      <div className="room-code">{room.code}</div>
      <button className="btn btn-small btn-blue" onClick={copy}>
        {copied ? "Link copiado!" : "Copiar link de convite"}
      </button>
      <ul className="players">
        {players.map((p) => (
          <li key={p.user_id} className="player">
            <Avatar id={p.user_id} />
            {p.user_id === room.host_id ? "👑 " : ""}
            {p.name}
            {p.user_id === userId ? " (você)" : ""}
          </li>
        ))}
      </ul>
      <div className="stats">
        {room.total_rounds} rodadas · {room.round_seconds}s cada · cada um recebe o seu próprio item
      </div>
      <div className="actions">
        {room.host_id === userId ? (
          <button className="btn btn-yellow" onClick={onStart}>
            Começar partida!
          </button>
        ) : (
          <span className="stats">Aguardando o anfitrião começar…</span>
        )}
      </div>
    </div>
  );
}

export function RoundStatus({
  round,
  players,
  userId,
  cuts,
}: {
  round: Round;
  players: Player[];
  userId: string;
  cuts: Cut[];
}) {
  const end = new Date(round.deadline).getTime() - DEADLINE_SLACK_MS;
  const total = Math.max(1, (end - new Date(round.started_at).getTime()) / 1000);
  const remaining = useCountdown(end);
  useEffect(() => {
    if (remaining > 0 && remaining <= 5) sfx.tick(remaining <= 3);
  }, [remaining]);
  const iCut = cuts.some((c) => c.round_id === round.id && c.user_id === userId);
  const done = players.filter((p) => p.last_cut_round >= round.number).length;

  return (
    <div className="round-status">
      <div
        className={`timer ${remaining <= 10 ? "urgent" : ""}`}
        style={{ "--p": Math.min(1, remaining / total) } as CSSProperties}
      >
        {remaining}
      </div>
      <div className="cut-chips">
        {players.map((p) => (
          <span key={p.user_id} className={p.last_cut_round >= round.number ? "chip done" : "chip"}>
            {p.last_cut_round >= round.number ? "✓ " : ""}
            {p.name}
          </span>
        ))}
      </div>
      <div className="hint">
        {iCut
          ? `Corte enviado! Aguardando os outros (${done}/${players.length})…`
          : remaining > 0
            ? "Corte o seu item exatamente no meio. Clique ou Espaço."
            : "Tempo esgotado!"}
      </div>
    </div>
  );
}

function useCountdown(until: number): number {
  const calc = () => Math.max(0, Math.ceil((until - Date.now()) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setLeft(calc()), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until]);
  return left;
}

/** Players ranked for one round: best (lowest error) first, no-shows last. */
function ranking(round: Round, players: Player[], cuts: Cut[]) {
  return players
    .map((p) => ({ player: p, cut: cuts.find((c) => c.round_id === round.id && c.user_id === p.user_id) }))
    .sort((a, b) => (a.cut?.error ?? Infinity) - (b.cut?.error ?? Infinity));
}

export function RoundResults({
  room,
  round,
  players,
  cuts,
  userId,
  isHost,
  onNext,
}: {
  room: Room;
  round: Round;
  players: Player[];
  cuts: Cut[];
  userId: string;
  isHost: boolean;
  onNext(): void;
}) {
  const rows = ranking(round, players, cuts);
  const winner = players.find((p) => p.user_id === round.winner_id);
  const mine = cuts.find((c) => c.round_id === round.id && c.user_id === userId);
  useEffect(() => {
    const id = setTimeout(() => {
      if (round.winner_id === userId) sfx.fanfare();
      else sfx.result(mine ? rateError(mine.error).tone : "bad");
    }, 500);
    return () => clearTimeout(id);
    // Once per round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id]);

  return (
    <div className="result panel">
      <div className="rating great">
        {winner ? (winner.user_id === userId ? "Você venceu a rodada!" : `${winner.name} venceu!`) : "Ninguém cortou!"}
      </div>
      {mine && <Balance left={mine.mass_back} right={mine.mass_front} />}
      <table className="ranking">
        <tbody>
          {rows.map(({ player, cut }) => {
            const front = cut ? cut.mass_front / (cut.mass_front + cut.mass_back || 1) : 0;
            return (
              <tr key={player.user_id} className={player.user_id === userId ? "me" : ""}>
                <td>{player.user_id === round.winner_id ? "🏆" : ""}</td>
                <td className="name">
                  <Avatar id={player.user_id} /> {player.name}
                </td>
                {cut ? (
                  <>
                    <td className="split">
                      {pct(Math.min(front, 1 - front))} / {pct(Math.max(front, 1 - front))}
                    </td>
                    <td>
                      <b>{pct(cut.error)}</b> <span className="muted">{rateError(cut.error).label}</span>
                    </td>
                  </>
                ) : (
                  <td colSpan={2} className="muted">
                    não cortou
                  </td>
                )}
                <td className="wins">{player.wins} 🏆</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="stats">
        Sua linha verde mostra onde estava o meio exato · rodada {round.number}/{room.total_rounds}
      </div>
      <div className="actions">
        {isHost ? (
          <button className="btn btn-yellow" onClick={onNext} autoFocus>
            Próxima rodada
          </button>
        ) : (
          <span className="stats">Aguardando o anfitrião…</span>
        )}
      </div>
    </div>
  );
}

export function FinalScoreboard({
  round,
  players,
  cuts,
  userId,
  onExit,
}: {
  round: Round;
  players: Player[];
  cuts: Cut[];
  userId: string;
  onExit(): void;
}) {
  // Ties on wins go to the better average error over the rounds they cut.
  const avgError = (p: Player) => {
    const mine = cuts.filter((c) => c.user_id === p.user_id);
    return mine.length ? mine.reduce((s, c) => s + c.error, 0) / mine.length : Infinity;
  };
  const sorted = [...players].sort((a, b) => b.wins - a.wins || avgError(a) - avgError(b));
  const champion = sorted[0];
  const last = ranking(round, players, cuts)[0];

  return (
    <div className="result panel">
      <div className="rating great">
        {champion ? (champion.user_id === userId ? "Você é o campeão! 🏆" : `${champion.name} é o campeão! 🏆`) : "Fim de jogo"}
      </div>
      <table className="ranking">
        <tbody>
          {sorted.map((p, i) => (
            <tr key={p.user_id} className={p.user_id === userId ? "me" : ""}>
              <td>{["🥇", "🥈", "🥉"][i] ?? `${i + 1}º`}</td>
              <td className="name">
                <Avatar id={p.user_id} /> {p.name}
              </td>
              <td className="wins">{p.wins} rodadas</td>
              <td className="muted">erro médio {Number.isFinite(avgError(p)) ? pct(avgError(p)) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {last?.cut && (
        <div className="stats">
          Última rodada: {last.player.name} com {pct(last.cut.error)} de erro
        </div>
      )}
      <div className="actions">
        <button className="btn btn-yellow" onClick={onExit}>
          Voltar ao início
        </button>
      </div>
    </div>
  );
}
