import { OBJECT_KINDS, type ObjectKind } from "@slice-even/core";
import { KIND_EMOJI, KIND_LABELS, rateError, type CutOutcome, type KindMode } from "../game.ts";
import { Balance } from "./Balance.tsx";
import { useEffect } from "react";
import { sfx } from "../audio/sfx.ts";

const MODES: readonly KindMode[] = ["random", ...OBJECT_KINDS];
const modeLabel = (mode: KindMode) => (mode === "random" ? "🎲 Aleatório" : `${KIND_EMOJI[mode]} ${KIND_LABELS[mode]}`);

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const mm = (cm: number) => `${(Math.abs(cm) * 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mm`;

interface HudProps {
  kind: ObjectKind;
  seed: string;
  mode: KindMode;
  outcome: CutOutcome | null;
  onMode(mode: KindMode): void;
  onNext(): void;
  onRetry(): void;
  onHome(): void;
}

export function Hud({ kind, seed, mode, outcome, onMode, onNext, onRetry, onHome }: HudProps) {
  return (
    <div className="hud">
      <header className="hud-top">
        <button className="btn btn-small" onClick={onHome}>
          ← Início
        </button>
        <h1 className="hud-title">Treino</h1>
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

      {!outcome && <ControlsHint />}
      {outcome && <Result outcome={outcome} onNext={onNext} onRetry={onRetry} />}
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
  return (
    <div className="hint">
      <b>Mouse</b> mira · <b>Roda</b> ou <b>Q/E</b> gira · <b>Setas</b> ajuste fino · <b>Shift</b> precisão ·{" "}
      <b>Botão direito</b> orbita · <b>Clique</b> ou <b>Espaço</b> corta
    </div>
  );
}

function Result({ outcome, onNext, onRetry }: { outcome: CutOutcome; onNext(): void; onRetry(): void }) {
  const { score } = outcome;
  const rating = rateError(score.error);
  const smaller = Math.min(score.fractionFront, 1 - score.fractionFront);
  const missed = smaller === 0;
  const sliver = !missed && smaller < 0.02;
  const label = missed ? "Errou o alvo!" : sliver ? "Só uma lasquinha!" : rating.label;
  const tone = missed || sliver ? "bad" : rating.tone;

  // Timed with the rating sticker popping in.
  useEffect(() => {
    const id = setTimeout(() => sfx.result(tone), 550);
    return () => clearTimeout(id);
  }, [tone]);

  return (
    <div className="result panel">
      <div className={`rating ${missed || sliver ? "bad" : rating.tone}`}>{label}</div>
      {!missed && (
        <>
          <Balance left={score.massBack} right={score.massFront} />
          <div className="stats">
            Erro <b>{pct(score.error)}</b> · {mm(outcome.offsetFromIdeal)} do corte perfeito{" "}
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
