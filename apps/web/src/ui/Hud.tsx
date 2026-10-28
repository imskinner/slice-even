import { OBJECT_KINDS, type ObjectKind } from "@slice-even/core";
import { KIND_LABELS, rateError, type CutOutcome, type KindMode } from "../game.ts";

const MODES: readonly KindMode[] = ["random", ...OBJECT_KINDS];
const modeLabel = (mode: KindMode) => (mode === "random" ? "Aleatório" : KIND_LABELS[mode]);

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const grams = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} g`;
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
        <button className="chip back" onClick={onHome}>
          ← Início
        </button>
        <h1>Treino</h1>
        <span className="seed">
          {KIND_LABELS[kind]} · seed {seed}
        </span>
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

      {!outcome && (
        <div className="hint">
          <b>Mouse</b> mira · <b>Roda</b> ou <b>Q/E</b> gira · <b>Setas</b> ajuste fino · <b>Shift</b> precisão ·{" "}
          <b>Botão direito</b> orbita · <b>Clique</b> ou <b>Espaço</b> corta
        </div>
      )}

      {outcome && <Result outcome={outcome} onNext={onNext} onRetry={onRetry} />}
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

  return (
    <div className="result">
      <div className={`rating ${missed || sliver ? "bad" : rating.tone}`}>{label}</div>
      {!missed && (
        <>
          <div className="halves">
            <Half fraction={1 - score.fractionFront} mass={score.massBack} />
            <div className="scale-divider" />
            <Half fraction={score.fractionFront} mass={score.massFront} />
          </div>
          <div className="stats">
            Erro <b>{pct(score.error)}</b> · {mm(outcome.offsetFromIdeal)} do corte perfeito{" "}
            <span className="legend">(linha verde)</span>
          </div>
        </>
      )}
      <div className="actions">
        <button onClick={onRetry}>Tentar de novo</button>
        <button className="primary" onClick={onNext} autoFocus>
          Próximo
        </button>
      </div>
    </div>
  );
}

function Half({ fraction, mass }: { fraction: number; mass: number }) {
  return (
    <div className="half">
      <div className="half-pct">{pct(fraction)}</div>
      <div className="half-mass">{grams(mass)}</div>
    </div>
  );
}
