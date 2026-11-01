import { useCallback, useEffect, useMemo, useState } from "react";
import { generateObject, type Plane } from "@slice-even/core";
import { GameCanvas } from "./scene/GameCanvas.tsx";
import { SliceStage } from "./scene/SliceStage.tsx";
import { ControlsHint, ItemBadge } from "./ui/Hud.tsx";
import { Balance } from "./ui/Balance.tsx";
import { appearanceFor, evaluateCut, KIND_EMOJI, KIND_LABELS, objectSpan, rateError, type CutOutcome } from "./game.ts";
import { fetchDaily, recordStreak, submitDaily, type DailyResponse } from "./net/daily.ts";
import { loadName } from "./Home.tsx";
import { sfx } from "./audio/sfx.ts";
import { recordCut, recordDailyStreak } from "./progress/stats.ts";

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Five squares, Wordle style: how close to perfect. */
function precisionBar(error: number): string {
  const filled = error < 0.005 ? 5 : error < 0.01 ? 4 : error < 0.02 ? 3 : error < 0.05 ? 2 : error < 0.1 ? 1 : 0;
  return "🟩".repeat(filled) + "⬜".repeat(5 - filled);
}

function shareText(daily: DailyResponse, streak: number): string {
  const mine = daily.mine!;
  const { puzzle } = daily;
  const lines = [
    `🔪 Slice Even #${puzzle.number} · ${KIND_EMOJI[puzzle.kind]} ${KIND_LABELS[puzzle.kind]}`,
    `${precisionBar(mine.score.error)} ${pct(mine.score.error)} de erro`,
    `🏆 ${mine.rank}º de ${mine.total}${mine.total > 1 ? ` (melhor que ${Math.round(mine.beat * 100)}%)` : ""}`,
    streak > 1 ? `🔥 ${streak} dias seguidos` : "",
    `${location.origin}${location.pathname}?daily=1`,
  ];
  return lines.filter(Boolean).join("\n");
}

function useCountdownTo(ms: number) {
  const [end] = useState(() => Date.now() + ms);
  const [left, setLeft] = useState(ms);
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, end - Date.now())), 1000);
    return () => clearInterval(id);
  }, [end]);
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return `${h}h ${String(m).padStart(2, "0")}min`;
}

/**
 * Daily challenge: the same object for everyone today, one attempt, a world
 * ranking and a result to paste in the group chat.
 */
export function DailyGame({ onExit, onPractice }: { onExit(): void; onPractice(): void }) {
  const [daily, setDaily] = useState<DailyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<CutOutcome | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchDaily().then(setDaily, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const url = new URL(location.href);
    url.search = "?daily=1";
    history.replaceState(null, "", url);
  }, []);

  const object = useMemo(() => (daily ? generateObject(daily.puzzle.kind, daily.puzzle.seed) : null), [daily?.puzzle.seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const look = useMemo(() => appearanceFor(daily?.puzzle.seed ?? ""), [daily?.puzzle.seed]);
  const span = useMemo(() => (object ? objectSpan(object) : 9), [object]);

  // Coming back after playing: rebuild the halves from the saved plane.
  const outcome = useMemo(() => {
    if (local) return local;
    const plane = daily?.mine?.plane;
    return object && plane ? evaluateCut(object, plane) : null;
  }, [local, daily, object]);

  const handleCut = useCallback(
    (plane: Plane) => {
      if (!object) return;
      setLocal(evaluateCut(object, plane));
      setSubmitting(true);
      submitDaily(loadName() || "Anônimo", plane).then(
        (res) => {
          if (res.mine) recordCut({ kind: res.puzzle.kind, error: res.mine.score.error });
          setDaily(res);
          setSubmitting(false);
        },
        (e: Error) => {
          setError(e.message);
          setSubmitting(false);
        },
      );
    },
    [object],
  );

  return (
    <>
      <GameCanvas span={span}>
        {object && (
          <SliceStage
            object={object}
            skinColor={look.skinColor}
            stemTilt={look.stemTilt}
            outcome={outcome}
            onCut={handleCut}
            locked={!!daily?.mine}
          />
        )}
      </GameCanvas>
      <div className="hud">
        <header className="hud-top">
          <button className="btn btn-small" onClick={onExit}>
            ← Início
          </button>
          <h1 className="hud-title">Desafio do dia{daily ? ` #${daily.puzzle.number}` : ""}</h1>
          {daily && <ItemBadge kind={daily.puzzle.kind} extra={`${daily.total} já jogaram`} />}
        </header>

        {error && <div className="toast error">{error}</div>}
        {!daily && !error && <div className="hint">Carregando o desafio…</div>}
        {daily && !outcome && (
          <div className="round-status">
            <div className="rule-chip">
              🗓️ <b>Uma tentativa só!</b> Todo mundo corta este mesmo item hoje.
            </div>
            <ControlsHint />
          </div>
        )}
        {outcome && (daily?.mine ? <DailyResult daily={daily} onPractice={onPractice} /> : submitting && <div className="hint">Pesando…</div>)}
      </div>
    </>
  );
}

function DailyResult({ daily, onPractice }: { daily: DailyResponse; onPractice(): void }) {
  const mine = daily.mine!;
  const rating = rateError(mine.score.error);
  const [streak] = useState(() => recordStreak(daily.puzzle.date));
  useEffect(() => recordDailyStreak(streak), [streak]);
  const [copied, setCopied] = useState(false);
  const next = useCountdownTo(daily.nextInMs);

  useEffect(() => {
    const id = setTimeout(() => sfx.result(rating.tone), 550);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const share = async () => {
    const text = shareText(daily, streak);
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
    } catch {
      // Share sheet dismissed.
    }
  };

  return (
    <div className="result panel">
      <div className={`rating ${rating.tone}`}>{rating.label}</div>
      <Balance left={mine.score.massBack} right={mine.score.massFront} />
      <div className="daily-rank">
        {precisionBar(mine.score.error)} <b>{pct(mine.score.error)}</b> de erro · <b>{mine.rank}º</b> de {mine.total}
        {mine.total > 1 && <> · melhor que {Math.round(mine.beat * 100)}%</>}
        {streak > 1 && <> · 🔥 {streak} dias</>}
      </div>
      <table className="ranking scoreboard">
        <tbody>
          {daily.leaderboard.map((row, i) => (
            <tr key={i} className={row.you ? "me" : ""}>
              <td>{["🥇", "🥈", "🥉"][i] ?? `${i + 1}º`}</td>
              <td className="name">{row.you ? `${row.name} (você)` : row.name}</td>
              <td className="total">{pct(row.error)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="stats">Próximo desafio em {next}</div>
      <div className="actions">
        <button className="btn btn-green" onClick={share}>
          {copied ? "Copiado! ✓" : "Compartilhar resultado"}
        </button>
        <button className="btn" onClick={onPractice}>
          Treinar
        </button>
      </div>
    </div>
  );
}
