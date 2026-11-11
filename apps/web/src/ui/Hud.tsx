import { OBJECT_KINDS, type ObjectKind, type RoundRule } from "@slice-even/core";
import { KIND_EMOJI, KIND_LABELS, rateError, ruleInfo, type CutOutcome, type KindMode } from "../game.ts";
import { useEffect } from "react";
import { sfx } from "../audio/sfx.ts";
import { isTouchDevice } from "./TouchControls.tsx";
import { useSceneShift, type SceneShift } from "./ResultDock.tsx";

const MODES: readonly KindMode[] = ["random", ...OBJECT_KINDS];
const modeLabel = (mode: KindMode) => (mode === "random" ? "🎲 Aleatório" : `${KIND_EMOJI[mode]} ${KIND_LABELS[mode]}`);

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const mm = (cm: number) => `${(Math.abs(cm) * 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mm`;

interface HudProps {
  kind: ObjectKind;
  seed: string;
  mode: KindMode;
  /** The twist being practiced (`?rule=` in the URL), and the object's weight for the ones that mention it. */
  rule?: RoundRule;
  mass?: number;
  outcome: CutOutcome | null;
  /** This cut beat your previous best for this item. */
  newBest?: boolean;
  onMode(mode: KindMode): void;
  onNext(): void;
  onRetry(): void;
  onHome(): void;
  /** Tells the scene how far to slide so the result does not cover the cut. */
  onShift?(shift: SceneShift): void;
}

export function Hud({
  kind,
  seed,
  mode,
  rule,
  mass,
  outcome,
  newBest = false,
  onMode,
  onNext,
  onRetry,
  onHome,
  onShift,
}: HudProps) {
  const twist = rule && rule.type !== "classic" ? ruleInfo(rule, mass) : null;
  return (
    <div className="hud">
      <header className="hud-top">
        <button className="btn btn-small" onClick={onHome}>
          ← Início
        </button>
        {/* Phones drop the title: the item badge says enough, and the modes need the room. */}
        <h1 className="hud-title wide-only">Treino</h1>
        <ItemBadge kind={kind} extra={`#${seed}`} />
        <nav className="modes">
          {MODES.map((m) => (
            <button
              key={m}
              className={m === mode ? "chip active" : "chip"}
              onClick={(e) => {
                e.currentTarget.blur();
                onMode(m);
              }}
            >
              {modeLabel(m)}
            </button>
          ))}
        </nav>
      </header>

      {twist && !outcome && (
        <div className="round-bar">
          <div className="rule-chip">
            {twist.emoji} <b>{twist.title}</b> · {twist.goal}
          </div>
        </div>
      )}
      {!outcome && <ControlsHint />}
      {outcome && <Result outcome={outcome} newBest={newBest} onNext={onNext} onRetry={onRetry} onShift={onShift} />}
    </div>
  );
}

export function ItemBadge({ kind, extra }: { kind: ObjectKind; extra?: string }) {
  return (
    <span className="item-badge">
      <span className="emoji">{KIND_EMOJI[kind]}</span>
      {KIND_LABELS[kind]}
      {extra && <span className="muted">{extra}</span>}
    </span>
  );
}

export function ControlsHint() {
  if (isTouchDevice()) {
    return (
      <div className="hint">
        <b>Arraste</b> para mirar · <b>⟲ ⟳</b> giram a faca · <b>dois dedos</b> giram a câmera
      </div>
    );
  }
  return (
    <div className="hint">
      <b>Mouse</b> mira · <b>Roda</b> ou <b>Q/E</b> gira · <b>Setas</b> ajuste fino · <b>Shift</b> precisão ·{" "}
      <b>Botão direito</b> orbita · <b>Clique</b> ou <b>Espaço</b> corta
    </div>
  );
}

function Result({
  outcome,
  newBest,
  onNext,
  onRetry,
  onShift,
}: {
  outcome: CutOutcome;
  newBest: boolean;
  onNext(): void;
  onRetry(): void;
  onShift?(shift: SceneShift): void;
}) {
  const panel = useSceneShift(onShift);
  const { score } = outcome;
  const rating = rateError(score.error);
  // Two pieces, or three in a "thirds" round.
  const total = score.massFront + score.massBack + (score.massMid ?? 0) || 1;
  const shares = (score.massMid === undefined ? [score.massBack, score.massFront] : [score.massBack, score.massMid, score.massFront]).map(
    (m) => m / total,
  );
  const smaller = Math.min(...shares);
  const missed = smaller === 0;
  const sliver = !missed && smaller < 0.02;
  const label = missed ? "Errou o alvo!" : sliver ? "Só uma lasquinha!" : rating.label;
  const tone = missed || sliver ? "bad" : rating.tone;

  // Timed with the rating sticker popping in, once the balance in the scene has tipped.
  useEffect(() => {
    const id = setTimeout(() => sfx.result(tone), 1500);
    return () => clearTimeout(id);
  }, [tone]);

  return (
    <div className="result panel after-weigh" ref={panel}>
      <div className={`rating ${missed || sliver ? "bad" : rating.tone}`}>{label}</div>
      {newBest && <div className="new-best">🏅 Novo recorde!</div>}
      {!missed && (
        <>
          <div className="stats">
            Erro <b>{pct(score.error)}</b> ·{" "}
            {shares.length === 3 ? <>pedaços de {shares.map(pct).join(" / ")}</> : <>{mm(outcome.offsetFromIdeal)} do corte perfeito</>}{" "}
            <span className="legend">(linha verde)</span>
          </div>
        </>
      )}
      <div className="actions">
        <button className="btn" onClick={onRetry}>
          Tentar de novo
        </button>
        <button className="btn btn-yellow" onClick={onNext} autoFocus>
          Próximo →
        </button>
      </div>
    </div>
  );
}
