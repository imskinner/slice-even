import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ruleTarget } from "@slice-even/core";
import { REVEAL, revealSchedule } from "@slice-even/server/protocol";
import type { Cut, Player, Room, Round } from "../net/rooms.ts";
import { rateError } from "../game.ts";
import { sfx } from "../audio/sfx.ts";
import { ResultDock, type SceneShift } from "../ui/ResultDock.tsx";
import { Avatar, displayName, rankPlayers, seatColor } from "./players.tsx";
import { ReactionBar } from "./Reactions.tsx";
import { FinalScreen } from "./FinalScreen.tsx";
import { pct, useCountdown } from "./RoomPanels.tsx";

/** One person's line in the list: what they did this round and where they stand. */
interface Row {
  player: Player;
  /** Took part in this round (late joiners did not). */
  inRound: boolean;
  cut: Cut | undefined;
  points: number;
  /** 1-based place in this round (no-shows last); 0 if not in the round. */
  place: number;
  /** 1-based place in the game, now and before this round's points. */
  standing: number;
  standingBefore: number;
}

function buildRows(round: Round, rounds: Round[], players: Player[], cuts: Cut[]): Row[] {
  const cutOf = (id: string) => cuts.find((c) => c.round_id === round.id && c.user_id === id);
  const placing = players
    .filter((p) => round.participants.includes(p.user_id))
    .sort((a, b) => (cutOf(a.user_id)?.error ?? Infinity) - (cutOf(b.user_id)?.error ?? Infinity))
    // The server breaks ties by who cut first; it tells us the winner.
    .sort((a, b) => Number(b.user_id === round.winner_id) - Number(a.user_id === round.winner_id));
  const now = rankPlayers(players, rounds, cuts);
  const before = rankPlayers(players, rounds, cuts, round.number - 1);
  return players.map((player) => ({
    player,
    inRound: round.participants.includes(player.user_id),
    cut: cutOf(player.user_id),
    points: round.points[player.user_id] ?? 0,
    place: placing.indexOf(player) + 1,
    standing: now.indexOf(player) + 1,
    standingBefore: before.indexOf(player) + 1,
  }));
}

/**
 * The weigh-in: results come out from the worst cut to the best, quickly
 * for the also-rans and with a drum roll for the podium (the server waits
 * for the same schedule). Opening the page after it happened skips it.
 */
function useReveal(round: Round, count: number, onDone: () => void) {
  const [alreadyOver] = useState(
    () => round.scored_at !== null && Date.now() > new Date(round.scored_at).getTime() + revealSchedule(count).total + 1000,
  );
  const [shown, setShown] = useState(alreadyOver ? count : 0);
  const [done, setDone] = useState(alreadyOver);

  useEffect(() => {
    if (alreadyOver) return;
    const { steps, total } = revealSchedule(count);
    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((step, i) => {
      if (step.roll) timers.push(setTimeout(() => sfx.drumroll(REVEAL.rollMs / 1000), step.at - REVEAL.rollMs));
      timers.push(
        setTimeout(() => {
          setShown(i + 1);
          if (step.roll) sfx.reveal();
          else sfx.pop();
        }, step.at),
      );
    });
    timers.push(
      setTimeout(() => {
        setDone(true);
        onDone();
      }, total + 700),
    );
    return () => timers.forEach(clearTimeout);
    // Once per round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.id]);

  return { shown, done, alreadyOver };
}

/**
 * Rows glide to their new position when the order changes (the reveal
 * order turning into the game standings), so overtakes are visible.
 */
function useFlip() {
  const list = useRef<HTMLUListElement>(null);
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const id = child.dataset.flip;
      if (!id) continue;
      next.set(id, child.offsetTop);
      const before = tops.current.get(id);
      if (before !== undefined && before !== child.offsetTop && !still) {
        child.animate([{ transform: `translateY(${before - child.offsetTop}px)` }, { transform: "none" }], {
          duration: 650,
          easing: "cubic-bezier(0.2, 1.2, 0.4, 1)",
        });
      }
    }
    tops.current = next;
  });
  return list;
}

const MEDALS = ["🥇", "🥈", "🥉"];

function ErrorCell({ row }: { row: Row }) {
  if (!row.inRound) return <span className="srow-err none">—</span>;
  if (!row.cut) return <span className="srow-err none">💤</span>;
  return <span className={`srow-err ${rateError(row.cut.error).tone}`}>{pct(row.cut.error)}</span>;
}

function StandingRow({
  row,
  color,
  me,
  mode,
  winner,
  showMove,
}: {
  row: Row;
  color: string;
  me: boolean;
  /** "round": numbered by this round's place. "game": by the standings, with totals. */
  mode: "round" | "game";
  winner: boolean;
  /** Places gained or lost this round (pointless after round 1: there was no order yet). */
  showMove: boolean;
}) {
  const moved = showMove ? row.standingBefore - row.standing : 0;
  // No medal for a place held with zero points.
  const medal = row.player.score > 0 ? MEDALS[row.standing - 1] : undefined;
  return (
    <li className={`srow${me ? " me" : ""}${mode === "round" ? " pop" : ""}`} data-flip={row.player.user_id}>
      {mode === "round" ? (
        <span className="srow-rank">{winner ? "🏆" : `${row.place}º`}</span>
      ) : (
        <span className={`srow-rank${medal ? " medal" : ""}`}>{medal ?? `${row.standing}º`}</span>
      )}
      <Avatar player={row.player} color={color} />
      <span className="srow-name">
        <span>
          {displayName(row.player)}
          {me ? " (você)" : ""}
        </span>
        {mode === "game" && winner && <span className="srow-move">🏆</span>}
        {mode === "game" && moved !== 0 && (
          <span className={`srow-move ${moved > 0 ? "up" : "down"}`}>
            {moved > 0 ? "▲" : "▼"}
            {Math.abs(moved)}
          </span>
        )}
      </span>
      <ErrorCell row={row} />
      {row.points > 0 ? <span className="srow-pts">+{row.points}</span> : <span />}
      <span className="srow-total">{mode === "game" ? row.player.score : ""}</span>
    </li>
  );
}

/** Your cut as a bar split where the knife went, with a tick where it should have gone. */
function MyCut({ row, round, count }: { row: Row; round: Round; count: number }) {
  if (!row.cut) return <div className="my-cut">Você não cortou nesta rodada 💤</div>;
  const total = row.cut.mass_front + row.cut.mass_back || 1;
  const small = Math.min(row.cut.mass_front, row.cut.mass_back) / total;
  const target = ruleTarget(round.rule);
  const rating = rateError(row.cut.error);
  return (
    <div className="my-cut">
      <div className="split-bar" aria-hidden>
        <i style={{ width: `${small * 100}%` }} />
        <i />
        <span className="tick" style={{ left: `${Math.min(target, 1 - target) * 100}%` }} />
      </div>
      <b>{rating.label}</b> · {pct(small)} / {pct(1 - small)} · erro <b>{pct(row.cut.error)}</b> · <b>{row.place}º</b> de {count}
    </div>
  );
}

export function RoundResults({
  room,
  round,
  rounds,
  players,
  cuts,
  userId,
  isHost,
  onNext,
  onExit,
  onRematch,
  onReact,
  onShift,
}: {
  room: Room;
  round: Round;
  rounds: Round[];
  players: Player[];
  cuts: Cut[];
  userId: string;
  isHost: boolean;
  onNext(): void;
  onExit(): void;
  onRematch(): void;
  onReact(emoji: string): void;
  onShift(shift: SceneShift): void;
}) {
  const rows = buildRows(round, rounds, players, cuts);
  const inRound = rows.filter((r) => r.inRound).sort((a, b) => a.place - b.place);
  const mine = rows.find((r) => r.player.user_id === userId);
  const winner = players.find((p) => p.user_id === round.winner_id);
  const finished = room.status === "finished";

  const { shown, done, alreadyOver } = useReveal(round, inRound.length, () => {
    // The final has its own fanfare, on the podium.
    if (finished) return;
    if (round.winner_id === userId) sfx.fanfare();
    else sfx.result(mine?.cut ? rateError(mine.cut.error).tone : "bad");
  });

  // Game over: the last round's standings stay up for a moment, then the podium.
  const [podium, setPodium] = useState(finished && alreadyOver);
  useEffect(() => {
    if (!finished || !done || podium) return;
    const id = setTimeout(() => setPodium(true), 2200);
    return () => clearTimeout(id);
  }, [finished, done, podium]);

  const nextIn = useCountdown(round.next_start_at ? new Date(round.next_start_at).getTime() : 0);
  const list = useFlip();

  if (podium) {
    return (
      <FinalScreen
        room={room}
        rounds={rounds}
        players={players}
        cuts={cuts}
        userId={userId}
        onRematch={onRematch}
        onExit={onExit}
        onReact={onReact}
      />
    );
  }

  const headline = !done
    ? "Hora da pesagem…"
    : winner
      ? winner.user_id === userId
        ? "Você venceu a rodada!"
        : `${displayName(winner)} venceu a rodada!`
      : "Ninguém cortou!";

  // While revealing, slots fill from the bottom (worst cut) up; then everyone lines up by game score.
  const hiddenSlots = inRound.length - shown;
  const ordered = done ? [...rows].sort((a, b) => a.standing - b.standing) : inRound.slice(hiddenSlots);

  return (
    <ResultDock
      onShift={onShift}
      head={
        <>
          <div className="dock-title">{headline}</div>
          {done && mine?.inRound ? (
            <MyCut row={mine} round={round} count={inRound.length} />
          ) : (
            <div className="dock-sub">
              {!done
                ? "Do corte mais torto ao mais certeiro…"
                : finished
                  ? "Você chegou no fim da partida."
                  : "Você joga a partir da próxima rodada."}
            </div>
          )}
        </>
      }
      foot={
        <>
          <ReactionBar onReact={onReact} inline />
          {done && !finished && (
            <div className="actions">
              <span className="stats">
                Próxima rodada em <b>{nextIn}s</b> · vale {round.number + 1} pontos
              </span>
              {isHost && (
                <button className="btn btn-small btn-yellow" onClick={onNext}>
                  Pular ⏭
                </button>
              )}
            </div>
          )}
          {done && finished && <span className="stats">Subindo ao pódio…</span>}
        </>
      }
    >
      <div className="dock-label">
        {done
          ? `${finished ? "Placar final" : "Placar geral"} · rodada ${round.number}/${room.total_rounds}`
          : `Rodada ${round.number}/${room.total_rounds}`}
      </div>
      <ul className="standings" ref={list}>
        {!done &&
          Array.from({ length: hiddenSlots }, (_, i) => (
            <li key={`slot-${i}`} className={`srow hidden${i === hiddenSlots - 1 ? " next" : ""}`}>
              <span className="srow-rank">{i + 1}º</span>
              <span />
              <span className="srow-name">
                <span>?</span>
              </span>
            </li>
          ))}
        {ordered.map((row) => (
          <StandingRow
            key={row.player.user_id}
            row={row}
            color={seatColor(players, row.player.user_id)}
            me={row.player.user_id === userId}
            mode={done ? "game" : "round"}
            winner={row.player.user_id === round.winner_id}
            showMove={round.number > 1}
          />
        ))}
      </ul>
    </ResultDock>
  );
}
