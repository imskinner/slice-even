import { useEffect, useState, type CSSProperties } from "react";
import type { Cut, Player, Room, Round } from "../net/rooms.ts";
import { rateError, ruleInfo } from "../game.ts";
import { Balance } from "../ui/Balance.tsx";
import { sfx } from "../audio/sfx.ts";
import "./room.css";

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** The server deadline includes 2 s of slack for latency; players see the real limit. */
const DEADLINE_SLACK_MS = 2000;

const AVATAR_COLORS = ["#ffc93c", "#3fc5f0", "#36d96b", "#ff8a3d", "#ff3e7f", "#b28dff"];
const AVATAR_FACES = ["🍎", "🍊", "🍌", "🥒", "🥕", "🍅", "🍞", "🎂"];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/** Each player's color, shared by their avatar and their cut line. */
export function avatarColor(id: string): string {
  return AVATAR_COLORS[hashId(id) % AVATAR_COLORS.length]!;
}

/** Stable fruit avatar per player id. */
export function Avatar({ id }: { id: string }) {
  return (
    <span className="avatar" style={{ background: avatarColor(id) }}>
      {AVATAR_FACES[(hashId(id) >>> 8) % AVATAR_FACES.length]}
    </span>
  );
}

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
            <Avatar id={p.user_id} />
            {p.user_id === room.host_id ? "👑 " : ""}
            {p.name}
            {p.user_id === userId ? " (você)" : ""}
            {p.bot && isHost && (
              <button className="chip-x" aria-label={`Tirar ${p.name}`} onClick={() => onRemoveBot(p.user_id)}>
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
  const iCut = cuts.some((c) => c.round_id === round.id && c.user_id === userId);
  const inRound = players.filter((p) => round.participants.includes(p.user_id));
  const done = inRound.filter((p) => p.last_cut_round >= round.number).length;
  const waiting = !round.participants.includes(userId);
  const info = ruleInfo(round.rule);

  return (
    <div className="round-status">
      <div className="rule-chip">
        {info.emoji} <b>{info.title}</b> · {info.goal}
      </div>
      <div
        className={`timer ${remaining <= 5 ? "urgent" : ""}`}
        style={{ "--p": Math.min(1, remaining / total) } as CSSProperties}
      >
        {remaining}
      </div>
      <div className="cut-chips">
        {inRound.map((p) => (
          <span key={p.user_id} className={p.last_cut_round >= round.number ? "chip done" : "chip"}>
            {p.last_cut_round >= round.number ? "✓ " : ""}
            {p.name}
          </span>
        ))}
      </div>
      <div className="hint">
        {waiting
          ? "Você entrou no meio da rodada: joga a partir da próxima!"
          : iCut
            ? `Corte enviado! Aguardando os outros (${done}/${inRound.length})…`
            : remaining > 0
              ? `${info.goal} Clique ou Espaço.`
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

interface Placing {
  player: Player;
  cut: Cut | undefined;
  points: number;
}

/** Round participants, best (lowest error) first, no-shows last. */
function ranking(round: Round, players: Player[], cuts: Cut[]): Placing[] {
  return players
    .filter((p) => round.participants.includes(p.user_id))
    .map((p) => ({
      player: p,
      cut: cuts.find((c) => c.round_id === round.id && c.user_id === p.user_id),
      points: round.points[p.user_id] ?? 0,
    }))
    .sort((a, b) => (a.cut?.error ?? Infinity) - (b.cut?.error ?? Infinity));
}

/** Matches LIMITS.revealPerPlayerMs on the server, which waits for the reveal. */
const REVEAL_STEP_MS = 1400;
const REVEAL_ROLL_MS = 900;
const BETWEEN_ROUNDS_MS = 6000;

/**
 * The weigh-in: results come out one by one from the worst cut to the best,
 * each after a drum roll, like the TV show. Joining late (or reloading)
 * after the reveal skips straight to the summary.
 */
function useReveal(round: Round, count: number, onDone: () => void) {
  const [alreadyOver] = useState(
    () => round.next_start_at !== null && Date.now() > new Date(round.next_start_at).getTime() - BETWEEN_ROUNDS_MS,
  );
  const [shown, setShown] = useState(alreadyOver ? count : 0);
  const [done, setDone] = useState(alreadyOver);

  useEffect(() => {
    if (alreadyOver) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < count; i++) {
      const at = 600 + i * REVEAL_STEP_MS;
      timers.push(setTimeout(() => sfx.drumroll(REVEAL_ROLL_MS / 1000), at));
      timers.push(
        setTimeout(() => {
          setShown(i + 1);
          sfx.reveal();
        }, at + REVEAL_ROLL_MS),
      );
    }
    timers.push(
      setTimeout(
        () => {
          setDone(true);
          onDone();
        },
        600 + count * REVEAL_STEP_MS + 300,
      ),
    );
    return () => timers.forEach(clearTimeout);
    // Once per round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id]);

  return { shown, done };
}

function PlacingRow({ placing, winner, me }: { placing: Placing; winner: boolean; me: boolean }) {
  const { player, cut, points } = placing;
  const front = cut ? cut.mass_front / (cut.mass_front + cut.mass_back || 1) : 0;
  return (
    <tr className={`reveal-row${me ? " me" : ""}${winner ? " winner" : ""}`}>
      <td>{winner ? "🏆" : cut ? "" : "💤"}</td>
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
      <td className="points">{points > 0 ? `+${points}` : "0"}</td>
    </tr>
  );
}

function Scoreboard({ players, round, userId }: { players: Player[]; round: Round; userId: string }) {
  const sorted = [...players].sort((a, b) => b.score - a.score || b.wins - a.wins);
  return (
    <table className="ranking scoreboard">
      <tbody>
        {sorted.map((p, i) => (
          <tr key={p.user_id} className={p.user_id === userId ? "me" : ""}>
            <td>{["🥇", "🥈", "🥉"][i] ?? `${i + 1}º`}</td>
            <td className="name">
              <Avatar id={p.user_id} /> {p.name}
            </td>
            <td className="total">
              {p.score} {p.score === 1 ? "pt" : "pts"}
            </td>
            <td className="muted">{round.points[p.user_id] ? `+${round.points[p.user_id]} agora` : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RoundResults({
  room,
  round,
  players,
  cuts,
  userId,
  isHost,
  onNext,
  onExit,
}: {
  room: Room;
  round: Round;
  players: Player[];
  cuts: Cut[];
  userId: string;
  isHost: boolean;
  onNext(): void;
  onExit(): void;
}) {
  const rows = ranking(round, players, cuts);
  const worstFirst = [...rows].reverse();
  const winner = players.find((p) => p.user_id === round.winner_id);
  const mine = cuts.find((c) => c.round_id === round.id && c.user_id === userId);
  const finished = room.status === "finished";
  const champion = [...players].sort((a, b) => b.score - a.score || b.wins - a.wins)[0];

  const { shown, done } = useReveal(round, worstFirst.length, () => {
    const won = finished ? champion?.user_id === userId : round.winner_id === userId;
    if (won || finished) sfx.fanfare();
    else sfx.result(mine ? rateError(mine.error).tone : "bad");
  });

  const nextIn = useCountdown(round.next_start_at ? new Date(round.next_start_at).getTime() : 0);

  const headline = !done
    ? "Hora da pesagem…"
    : finished && champion
      ? champion.user_id === userId
        ? "Você é o campeão! 🏆"
        : `${champion.name} é o campeão! 🏆`
      : winner
        ? winner.user_id === userId
          ? "Você venceu a rodada!"
          : `${winner.name} venceu!`
        : "Ninguém cortou!";

  return (
    <div className="result panel">
      <div className="rating great">{headline}</div>

      {!done ? (
        <table className="ranking">
          <tbody>
            {worstFirst.slice(0, shown).map((placing) => (
              <PlacingRow
                key={placing.player.user_id}
                placing={placing}
                winner={placing.player.user_id === round.winner_id}
                me={placing.player.user_id === userId}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <>
          {mine && <Balance left={mine.mass_back} right={mine.mass_front} />}
          <table className="ranking">
            <tbody>
              {rows.map((placing) => (
                <PlacingRow
                  key={placing.player.user_id}
                  placing={placing}
                  winner={placing.player.user_id === round.winner_id}
                  me={placing.player.user_id === userId}
                />
              ))}
            </tbody>
          </table>
          <div className="lobby-label">Placar {finished ? "final" : "geral"}</div>
          <Scoreboard players={players} round={round} userId={userId} />
          <div className="stats">
            A linha verde mostra o corte perfeito · rodada {round.number}/{room.total_rounds}
          </div>
          <div className="actions">
            {finished ? (
              <button className="btn btn-yellow" onClick={onExit}>
                Voltar ao início
              </button>
            ) : (
              <>
                <span className="stats">
                  Próxima rodada em <b>{nextIn}s</b> · vale {round.number + 1} pontos
                </span>
                {isHost && (
                  <button className="btn btn-small btn-yellow" onClick={onNext}>
                    Pular ⏭
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
