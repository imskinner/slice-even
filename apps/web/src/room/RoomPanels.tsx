import { useEffect, useState } from "react";
import type { Cut, Player, Room, Round } from "../net/rooms.ts";
import { rateError } from "../game.ts";

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** The server deadline includes 2 s of slack for latency; players see the real limit. */
const DEADLINE_SLACK_MS = 2000;

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
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  const copy = () => {
    navigator.clipboard?.writeText(link).then(() => setCopied(true), () => undefined);
  };

  return (
    <div className="result lobby">
      <div className="lobby-label">Código da sala</div>
      <div className="room-code">{room.code}</div>
      <button className="link" onClick={copy}>
        {copied ? "Link copiado!" : "Copiar link de convite"}
      </button>
      <ul className="players">
        {players.map((p) => (
          <li key={p.user_id}>
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
          <button className="primary" onClick={onStart}>
            Começar partida
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
  const remaining = useCountdown(new Date(round.deadline).getTime() - DEADLINE_SLACK_MS);
  const iCut = cuts.some((c) => c.round_id === round.id && c.user_id === userId);
  const done = players.filter((p) => p.last_cut_round >= round.number).length;

  return (
    <div className="round-status">
      <div className={`timer ${remaining <= 10 ? "urgent" : ""}`}>{remaining}s</div>
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

  return (
    <div className="result">
      <div className="rating great">
        {winner ? (winner.user_id === userId ? "Você venceu a rodada!" : `${winner.name} venceu!`) : "Ninguém cortou!"}
      </div>
      <table className="ranking">
        <tbody>
          {rows.map(({ player, cut }) => {
            const front = cut ? cut.mass_front / (cut.mass_front + cut.mass_back || 1) : 0;
            return (
              <tr key={player.user_id} className={player.user_id === userId ? "me" : ""}>
                <td>{player.user_id === round.winner_id ? "🏆" : ""}</td>
                <td className="name">{player.name}</td>
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
          <button className="primary" onClick={onNext} autoFocus>
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
    <div className="result">
      <div className="rating great">
        {champion ? (champion.user_id === userId ? "Você é o campeão! 🏆" : `${champion.name} é o campeão! 🏆`) : "Fim de jogo"}
      </div>
      <table className="ranking">
        <tbody>
          {sorted.map((p, i) => (
            <tr key={p.user_id} className={p.user_id === userId ? "me" : ""}>
              <td>{["🥇", "🥈", "🥉"][i] ?? `${i + 1}º`}</td>
              <td className="name">{p.name}</td>
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
        <button className="primary" onClick={onExit}>
          Voltar ao início
        </button>
      </div>
    </div>
  );
}
