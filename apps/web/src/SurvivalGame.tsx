import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { precisionStars, type ObjectKind, type Plane, type RoundRule } from "@slice-even/core";
import { GameCanvas } from "./scene/GameCanvas.tsx";
import { SliceStage } from "./scene/SliceStage.tsx";
import { ControlsHint, ItemBadge } from "./ui/Hud.tsx";
import { BLIND_AFTER_MS, evaluateRuleCut, randomSeed, rateError, ruleInfo, type CutOutcome } from "./game.ts";
import { haptic, sfx } from "./audio/sfx.ts";
import { recordCut, recordSurvival } from "./progress/stats.ts";
import { NO_SHIFT, useSceneShift, type SceneShift } from "./ui/ResultDock.tsx";
import { Stars } from "./room/RoomPanels.tsx";
import { kindForRule, makeRule, useSoloRound } from "./solo.ts";

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

const LIVES = 3;
/** How long the result of a cut stays up before the next object drops. */
const FEEDBACK_MS = 2600;

/** Stars a cut needs to keep its life: the bar rises every five levels. */
export const starsNeeded = (level: number) => (level <= 5 ? 1 : level <= 10 ? 2 : 3);
/** Seconds on the clock: 16 at first, down to 8. */
const secondsFor = (level: number) => Math.max(8, 16 - Math.floor((level - 1) / 2));

/** The twists come in gradually: plain halves first, the hard ones later. */
function ruleFor(level: number): RoundRule {
  if (level <= 2) return { type: "classic" };
  const pool: RoundRule["type"][] = ["classic", "target", "grams"];
  if (level >= 5) pool.push("spin", "blind");
  if (level >= 7) pool.push("thirds");
  return makeRule(pool[Math.floor(Math.random() * pool.length)]!);
}

interface Turn {
  level: number;
  kind: ObjectKind;
  seed: string;
  rule: RoundRule;
  endsAt: number;
}

function newTurn(level: number): Turn {
  const rule = ruleFor(level);
  return { level, rule, kind: kindForRule(rule), seed: randomSeed(), endsAt: Date.now() + secondsFor(level) * 1000 };
}

interface Feedback {
  stars: number;
  /** Null when the clock ran out. */
  error: number | null;
  lostLife: boolean;
}

/**
 * Survival: one object after another against the clock, three lives. A cut
 * that earns too few stars costs a life, the bar rises every five levels and
 * the multiplayer twists join in along the way. The score is the level
 * reached and the stars collected.
 */
export function SurvivalGame({ onExit }: { onExit(): void }) {
  const [turn, setTurn] = useState(() => newTurn(1));
  const [lives, setLives] = useState(LIVES);
  const [stars, setStars] = useState(0);
  const [outcome, setOutcome] = useState<CutOutcome | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [over, setOver] = useState<{ newBest: boolean } | null>(null);
  const [shift, setShift] = useState<SceneShift>(NO_SHIFT);

  const { object, look, span, mass, stage } = useSoloRound(turn.kind, turn.seed, turn.rule);
  const info = ruleInfo(turn.rule, mass);
  const need = starsNeeded(turn.level);

  useEffect(() => {
    const url = new URL(location.href);
    url.search = "?survival=1";
    history.replaceState(null, "", url);
  }, []);

  // The clock. It stops once this turn has a result.
  const total = secondsFor(turn.level);
  // Tagged with its turn: a reading left over from the last one (a zero, after
  // a timeout) must not count against the next.
  const [clock, setClock] = useState({ seed: turn.seed, left: total });
  const remaining = clock.seed === turn.seed ? clock.left : total;
  useEffect(() => {
    if (feedback || over) return;
    const tick = () => setClock({ seed: turn.seed, left: Math.max(0, Math.ceil((turn.endsAt - Date.now()) / 1000)) });
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [turn, feedback, over]);

  /** Books the result of this turn; the next one (or the end) follows after a pause. */
  const livesRef = useRef(lives);
  livesRef.current = lives;
  const starsRef = useRef(stars);
  starsRef.current = stars;
  const settle = useCallback(
    (earned: number, error: number | null) => {
      const lostLife = earned < need;
      setFeedback({ stars: earned, error, lostLife });
      setStars((n) => n + earned);
      if (lostLife) setLives((n) => n - 1);
      const tone = error === null ? "bad" : lostLife ? "bad" : rateError(error).tone;
      // After the halves have landed on the balance.
      setTimeout(() => sfx.result(tone), error === null ? 0 : 1300);
      if (lostLife) haptic(120);
    },
    [need],
  );

  // Time is up without a cut.
  useEffect(() => {
    if (remaining === 0 && !feedback && !over) settle(0, null);
    if (remaining > 0 && remaining <= 5 && !feedback) sfx.tick(remaining <= 3);
  }, [remaining, feedback, over, settle]);

  // After the pause: the next object, or the end of the game.
  useEffect(() => {
    if (!feedback || over) return;
    const id = setTimeout(() => {
      if (livesRef.current <= 0) {
        setOver({ newBest: recordSurvival(turn.level, starsRef.current) });
        return;
      }
      setOutcome(null);
      setFeedback(null);
      setTurn(newTurn(turn.level + 1));
    }, FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [feedback, over, turn.level]);

  const handleCut = useCallback(
    (plane: Plane, plane2?: Plane) => {
      const result = evaluateRuleCut(object, turn.rule, plane, plane2);
      setOutcome(result);
      recordCut({ kind: object.kind, error: result.score.error, rule: turn.rule });
      settle(precisionStars(result.score.error), result.score.error);
    },
    [object, turn.rule, settle],
  );

  const restart = () => {
    setOver(null);
    setFeedback(null);
    setOutcome(null);
    setLives(LIVES);
    setStars(0);
    setTurn(newTurn(1));
  };

  return (
    <>
      <GameCanvas span={span} shift={shift} weighing={!!outcome}>
        <SliceStage
          key={`${turn.level}:${turn.seed}`}
          object={object}
          skinColor={look.skinColor}
          stemTilt={look.stemTilt}
          outcome={outcome}
          onCut={handleCut}
          locked={!!feedback}
          spin={stage.spin}
          cuts={stage.cuts}
          hideAfterMs={stage.blind ? BLIND_AFTER_MS : undefined}
        />
      </GameCanvas>
      <div className="hud">
        <header className="hud-top">
          <button className="btn btn-small" onClick={onExit}>
            ← Início
          </button>
          <h1 className="hud-title wide-only">Sobrevivência</h1>
          <ItemBadge kind={turn.kind} extra={`nível ${turn.level}`} />
          <span className="item-badge" aria-label={`${lives} de ${LIVES} vidas`}>
            {"❤️".repeat(Math.max(0, lives))}
            {"🤍".repeat(LIVES - Math.max(0, lives))}
          </span>
          <span className="item-badge">★ {stars}</span>
        </header>

        {!over && (
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
              <div className="seat-strip">
                <span className="seat-count">
                  Para não perder vida: <Stars count={need} />
                </span>
              </div>
            </div>
          </div>
        )}

        {!feedback && !over && <ControlsHint />}
        {feedback && !over && (
          <div className={`hint verdict${feedback.lostLife ? " lost" : ""}`}>
            {feedback.error === null ? (
              <b>⏰ Tempo esgotado!</b>
            ) : (
              <>
                <Stars count={feedback.stars} /> <b>{rateError(feedback.error).label}</b> · erro {pct(feedback.error)}
              </>
            )}
            {feedback.lostLife && <> · 💔 perdeu uma vida</>}
          </div>
        )}
        {over && <GameOver level={turn.level} stars={stars} newBest={over.newBest} onRestart={restart} onExit={onExit} onShift={setShift} />}
      </div>
    </>
  );
}

function GameOver({
  level,
  stars,
  newBest,
  onRestart,
  onExit,
  onShift,
}: {
  level: number;
  stars: number;
  newBest: boolean;
  onRestart(): void;
  onExit(): void;
  onShift(shift: SceneShift): void;
}) {
  const panel = useSceneShift(onShift);
  return (
    <div className="result panel" ref={panel}>
      <div className="rating bad">Fim de jogo!</div>
      {newBest && <div className="new-best">🏅 Novo recorde!</div>}
      <div className="stats">
        Você chegou ao <b>nível {level}</b> com <b>★ {stars}</b>
      </div>
      <div className="actions">
        <button className="btn" onClick={onExit}>
          Início
        </button>
        <button className="btn btn-yellow" onClick={onRestart} autoFocus>
          Jogar de novo
        </button>
      </div>
    </div>
  );
}
