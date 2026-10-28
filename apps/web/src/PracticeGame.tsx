import { useCallback, useEffect, useMemo, useState } from "react";
import { generateObject, OBJECT_KINDS, type ObjectKind, type Plane } from "@slice-even/core";
import { GameCanvas } from "./scene/GameCanvas.tsx";
import { SliceStage } from "./scene/SliceStage.tsx";
import { Hud } from "./ui/Hud.tsx";
import {
  appearanceFor,
  evaluateCut,
  isKindMode,
  pickKind,
  randomSeed,
  type CutOutcome,
  type KindMode,
} from "./game.ts";

interface Round {
  kind: ObjectKind;
  seed: string;
}

function initialState(): { mode: KindMode; round: Round } {
  const params = new URLSearchParams(location.search);
  const modeParam = params.get("mode");
  const mode: KindMode = isKindMode(modeParam) ? modeParam : "random";
  const itemParam = params.get("item");
  const kind = OBJECT_KINDS.includes(itemParam as ObjectKind) ? (itemParam as ObjectKind) : pickKind(mode);
  return { mode, round: { kind, seed: params.get("seed") || randomSeed() } };
}

/** Single-player training: unlimited objects, retries allowed, scored locally. */
export function PracticeGame({ onExit }: { onExit(): void }) {
  const [initial] = useState(initialState);
  const [mode, setMode] = useState<KindMode>(initial.mode);
  const [round, setRound] = useState<Round>(initial.round);
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<CutOutcome | null>(null);

  const object = useMemo(() => generateObject(round.kind, round.seed), [round]);
  const look = useMemo(() => appearanceFor(round.seed), [round]);

  // Keep the round in the URL so an object can be shared or reproduced.
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("practice", "1");
    url.searchParams.set("item", round.kind);
    url.searchParams.set("seed", round.seed);
    url.searchParams.set("mode", mode);
    history.replaceState(null, "", url);
  }, [round, mode]);

  const handleCut = useCallback((plane: Plane) => setOutcome(evaluateCut(object, plane)), [object]);

  const startRound = (nextMode: KindMode) => {
    setOutcome(null);
    setRound({ kind: pickKind(nextMode), seed: randomSeed() });
  };
  const changeMode = (nextMode: KindMode) => {
    setMode(nextMode);
    startRound(nextMode);
  };
  const retry = () => {
    setOutcome(null);
    setAttempt((a) => a + 1);
  };

  return (
    <>
      <GameCanvas>
        <SliceStage
          key={`${round.kind}:${round.seed}:${attempt}`}
          object={object}
          skinColor={look.skinColor}
          stemTilt={look.stemTilt}
          outcome={outcome}
          onCut={handleCut}
        />
      </GameCanvas>
      <Hud
        kind={round.kind}
        seed={round.seed}
        mode={mode}
        outcome={outcome}
        onMode={changeMode}
        onNext={() => startRound(mode)}
        onRetry={retry}
        onHome={onExit}
      />
    </>
  );
}
