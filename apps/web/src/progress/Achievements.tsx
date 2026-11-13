import { useEffect, useState } from "react";
import { OBJECT_KINDS } from "@slice-even/core";
import { ACHIEVEMENT_EVENT, ACHIEVEMENTS, GOLDEN_ERROR, goldenKinds, loadStats, type Achievement } from "./stats.ts";
import { KIND_EMOJI, KIND_LABELS } from "../game.ts";
import { sfx } from "../audio/sfx.ts";
import { isUnlocked, selectedSkin, selectSkin, SKINS, unlockHint } from "./skins.ts";
import "./progress.css";

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Sticker that drops in when an achievement unlocks, on any screen. */
export function AchievementToast() {
  const [queue, setQueue] = useState<Achievement[]>([]);
  const current = queue[0];

  useEffect(() => {
    const onUnlock = (e: Event) => setQueue((q) => [...q, (e as CustomEvent<Achievement>).detail]);
    window.addEventListener(ACHIEVEMENT_EVENT, onUnlock);
    return () => window.removeEventListener(ACHIEVEMENT_EVENT, onUnlock);
  }, []);

  useEffect(() => {
    if (!current) return;
    // After the result jingle, so the two do not clash.
    const sound = setTimeout(() => sfx.result("good"), 900);
    const next = setTimeout(() => setQueue((q) => q.slice(1)), 3400);
    return () => {
      clearTimeout(sound);
      clearTimeout(next);
    };
  }, [current]);

  if (!current) return null;
  return (
    <div className="achievement-toast panel" key={current.id} role="status">
      <span className="achievement-emoji">{current.emoji}</span>
      <div>
        <div className="achievement-kicker">Conquista desbloqueada!</div>
        <div className="achievement-title">{current.title}</div>
      </div>
    </div>
  );
}

/** Personal records per item, the golden collection and achievements. */
export function RecordsScreen({ onExit }: { onExit(): void }) {
  const [stats] = useState(loadStats);
  const [knife, setKnife] = useState(() => selectedSkin().id);
  const golden = goldenKinds(stats);

  return (
    <div className="records">
      <div className="records-card panel">
        <header className="records-head">
          <button className="btn btn-small" onClick={onExit}>
            ← Início
          </button>
          <h1 className="hud-title">Recordes</h1>
        </header>

        <div className="records-summary">
          <span>
            <b>{stats.cuts}</b> cortes
          </span>
          <span>
            <b>{stats.perfects}</b> perfeitos
          </span>
          <span>
            <b>{stats.roundsWon}</b> rodadas vencidas
          </span>
          <span>
            <b>{stats.gamesWon}</b> partidas vencidas
          </span>
          {stats.survival && (
            <span>
              sobrevivência: <b>nível {stats.survival.level}</b> · ★ {stats.survival.stars}
            </span>
          )}
        </div>

        <div className="lobby-label">
          Despensa de ouro · {golden.length}/{OBJECT_KINDS.length}{" "}
          <span className="muted">(abaixo de {pct(GOLDEN_ERROR)} em cada item)</span>
        </div>
        <div className="kind-grid">
          {OBJECT_KINDS.map((kind) => {
            const best = stats.best[kind];
            const gold = best !== undefined && best < GOLDEN_ERROR;
            return (
              <div key={kind} className={`kind-cell${gold ? " gold" : ""}${best === undefined ? " locked" : ""}`}>
                <div className="kind-emoji">{KIND_EMOJI[kind]}</div>
                <div className="kind-name">{KIND_LABELS[kind]}</div>
                <div className="kind-best">{best === undefined ? "—" : pct(best)}</div>
              </div>
            );
          })}
        </div>

        <div className="lobby-label">Facas · desbloqueie com conquistas</div>
        <div className="kind-grid">
          {SKINS.map((skin) => {
            const open = isUnlocked(skin, stats);
            return (
              <button
                key={skin.id}
                className={`kind-cell skin-cell${skin.id === knife ? " gold" : ""}${open ? "" : " locked"}`}
                disabled={!open}
                onClick={() => {
                  selectSkin(skin.id);
                  setKnife(skin.id);
                }}
              >
                <div className="kind-emoji">{open ? skin.emoji : "🔒"}</div>
                <div className="kind-name">{skin.name}</div>
                <div className="muted">{skin.id === knife ? "Em uso" : open ? "Usar" : unlockHint(skin)}</div>
              </button>
            );
          })}
        </div>

        <div className="lobby-label">
          Conquistas · {Object.keys(stats.achievements).length}/{ACHIEVEMENTS.length}
        </div>
        <ul className="achievement-list">
          {ACHIEVEMENTS.map((a) => {
            const got = stats.achievements[a.id];
            return (
              <li key={a.id} className={got ? "got" : ""}>
                <span className="achievement-emoji">{got ? a.emoji : "🔒"}</span>
                <div>
                  <div className="achievement-title">{a.title}</div>
                  <div className="muted">{a.description}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
