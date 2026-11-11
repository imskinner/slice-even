import { useEffect, useState, type CSSProperties } from "react";
import type { Cut, Player, Room, Round } from "../net/rooms.ts";
import { ruleInfo } from "../game.ts";
import { sfx } from "../audio/sfx.ts";
import { Avatar, displayName, seatColor } from "./players.tsx";
import { isTouchDevice } from "../ui/TouchControls.tsx";
import "./room.css";

export const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** The server deadline includes 2 s of slack for latency; players see the real limit. */
const DEADLINE_SLACK_MS = 2000;

type BotLevel = "easy" | "medium" | "hard";
const BOT_BUTTONS: [BotLevel, string][] = [
  ["easy", "Fácil"],
  ["medium", "Médio"],
  ["hard", "Difícil"],
];

export function Lobby({
  room,
  players,
  userId,
  onStart,
  onAddBot,
  onRemoveBot,
}: {
  room: Room;
  players: Player[];
  userId: string;
  onStart(): void;
  onAddBot(level: BotLevel): void;
  onRemoveBot(playerId: string): void;
}) {
  const isHost = room.host_id === userId;
  const startsIn = useCountdown(room.auto_start_at ? new Date(room.auto_start_at).getTime() : 0);
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
      {room.public && (
        <div className="rule-chip">
          ⚡ <b>Mesa pública</b> · começa em {startsIn}s · lugares vazios viram bots
        </div>
      )}
      <div className="lobby-label">Código da sala</div>
      <div className="room-code">{room.code}</div>
      <button className="btn btn-small btn-blue" onClick={copy}>
        {copied ? "Link copiado!" : "Copiar link de convite"}
      </button>
      <ul className="players">
        {players.map((p) => (
          <li key={p.user_id} className="player">
            <Avatar player={p} color={seatColor(players, p.user_id)} />
            {p.user_id === room.host_id ? "👑 " : ""}
            {displayName(p)}
            {p.user_id === userId ? " (você)" : ""}
            {p.bot && isHost && (
              <button className="chip-x" aria-label={`Tirar ${displayName(p)}`} onClick={() => onRemoveBot(p.user_id)}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {isHost && players.length < 8 && (
        <div className="bot-row">
          <span className="muted">Chamar bot:</span>
          {BOT_BUTTONS.map(([level, label]) => (
            <button key={level} className="chip" onClick={() => onAddBot(level)}>
              🤖 {label}
            </button>
          ))}
        </div>
      )}
      <div className="stats">
        {room.total_rounds} rodadas · <b>a rodada N vale N pontos</b> · cada rodada tem uma regra surpresa
      </div>
      <div className="actions">
        {isHost ? (
          <button className="btn btn-yellow" onClick={onStart}>
            {room.public ? "Começar agora!" : "Começar partida!"}
          </button>
        ) : (
          <span className="stats">{room.public ? `Começa em ${startsIn}s…` : "Aguardando o anfitrião começar…"}</span>
        )}
      </div>
    </div>
  );
}

/** Big card announcing the round's rule for a moment, then the corner chip takes over. */
export function RuleCard({ round, total }: { round: Round; total: number }) {
  const info = ruleInfo(round.rule);
  const [big, setBig] = useState(() => Date.now() - new Date(round.started_at).getTime() < 2500);
  useEffect(() => {
    if (!big) return;
    sfx.ding();
    const id = setTimeout(() => setBig(false), 2300);
    return () => clearTimeout(id);
    // Once per round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!big) return null;
  return (
    <div className="rule-card panel">
      <div className="rule-round">
        Rodada {round.number}/{total} · vale {round.number} {round.number === 1 ? "ponto" : "pontos"}
        {round.number === total ? " · FINAL!" : ""}
      </div>
      <div className="rule-emoji">{info.emoji}</div>
      <div className="rule-title">{info.title}</div>
      <div className="rule-goal">{info.goal}</div>
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
  const [touch] = useState(isTouchDevice);
  const iCut = cuts.some((c) => c.round_id === round.id && c.user_id === userId);
  const inRound = players.filter((p) => round.participants.includes(p.user_id));
  const done = inRound.filter((p) => p.last_cut_round >= round.number).length;
  const waiting = !round.participants.includes(userId);
  const info = ruleInfo(round.rule);

  const hint = waiting
    ? "Você entrou no meio da rodada: joga a partir da próxima!"
    : iCut
      ? `Corte enviado! ${inRound.length - done === 1 ? "Falta 1" : `Faltam ${inRound.length - done}`}…`
      : remaining <= 0
        ? "Tempo esgotado!"
        : touch
          ? "Arraste para mirar · ⟲ ⟳ giram"
          : "Clique ou Espaço corta · Roda ou Q/E gira a faca";

  return (
    <>
      {/* Everything about the round sits at the top, so the board and the controls below stay clear. */}
      <div className="round-bar">
        <div
          className={`timer ${remaining <= 5 ? "urgent" : ""}`}
          style={{ "--p": Math.min(1, remaining / total) } as CSSProperties}
        >
          {remaining}
        </div>
        <div className="round-bar-main">
          <div className="rule-chip">
            {info.emoji} <b>{info.title}</b> · {info.goal}
          </div>
          {/* Who has cut already: one avatar each instead of a row of name pills. */}
          <div className="seat-strip" aria-label={`${done} de ${inRound.length} já cortaram`}>
            {inRound.map((p) => (
              <span
                key={p.user_id}
                className={`seat${p.last_cut_round >= round.number ? " done" : ""}${p.online ? "" : " off"}`}
                title={displayName(p)}
              >
                <Avatar player={p} color={seatColor(players, p.user_id)} />
              </span>
            ))}
            <span className="seat-count">
              {done}/{inRound.length}
            </span>
          </div>
        </div>
      </div>
      <div className="hint">{hint}</div>
    </>
  );
}

export function useCountdown(until: number): number {
  const calc = () => Math.max(0, Math.ceil((until - Date.now()) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setLeft(calc()), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until]);
  return left;
}
