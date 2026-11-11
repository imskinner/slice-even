import { useCallback, useEffect, useState } from "react";
import { OBJECT_KINDS, type ObjectKind, type Plane, type RoundRule } from "@slice-even/core";
import { GameCanvas } from "./scene/GameCanvas.tsx";
import { SliceStage } from "./scene/SliceStage.tsx";
import { Hud } from "./ui/Hud.tsx";
import { BLIND_AFTER_MS, evaluateRuleCut, isKindMode, pickKind, randomSeed, type CutOutcome, type KindMode } from "./game.ts";
import { recordCut } from "./progress/stats.ts";
import { NO_SHIFT, type SceneShift } from "./ui/ResultDock.tsx";
import { kindForRule, parseRule, ruleParam, useSoloRound } from "./solo.ts";

interface Round {
  kind: ObjectKind;
  seed: string;
}

/** A kind for the mode; "random" respects the rule (a turning board wants a long object). */
const kindFor = (mode: KindMode, rule: RoundRule) => (mode === "random" ? kindForRule(rule) : pickKind(mode));

function initialState(): { mode: KindMode; round: Round; rule: RoundRule } {
  const params = new URLSearchParams(location.search);
  const modeParam = params.get("mode");
  const mode: KindMode = isKindMode(modeParam) ? modeParam : "random";
  const rule = parseRule(params.get("rule"));
  const itemParam = params.get("item");
  const kind = OBJECT_KINDS.includes(itemParam as ObjectKind) ? (itemParam as ObjectKind) : kindFor(mode, rule);
  return { mode, rule, round: { kind, seed: params.get("seed") || randomSeed() } };
}

/**
 * Single-player training: unlimited objects, retries allowed, scored
 * locally. `?rule=` in the URL practices any of the multiplayer twists.
 */
export function PracticeGame({ onExit }: { onExit(): void }) {
  const [initial] = useState(initialState);
  const [mode, setMode] = useState<KindMode>(initial.mode);
  const [round, setRound] = useState<Round>(initial.round);
  const [rule] = useState<RoundRule>(initial.rule);
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<CutOutcome | null>(null);

  const { object, look, span, mass, stage } = useSoloRound(round.kind, round.seed, rule);

  // Keep the round in the URL so an object can be shared or reproduced.
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("practice", "1");
    url.searchParams.set("item", round.kind);
    url.searchParams.set("seed", round.seed);
    url.searchParams.set("mode", mode);
    if (rule.type === "classic") url.searchParams.delete("rule");
    else url.searchParams.set("rule", ruleParam(rule));
    history.replaceState(null, "", url);
  }, [round, mode, rule]);

  const [newBest, setNewBest] = useState(false);
  const [shift, setShift] = useState<SceneShift>(NO_SHIFT);
  const handleCut = useCallback(
    (plane: Plane, plane2?: Plane) => {
      const result = evaluateRuleCut(object, rule, plane, plane2);
      setOutcome(result);
      setNewBest(recordCut({ kind: object.kind, error: result.score.error, rule }).newBest);
    },
    [object, rule],
  );

  const startRound = (nextMode: KindMode) => {
    setOutcome(null);
    setRound({ kind: kindFor(nextMode, rule), seed: randomSeed() });
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
      <GameCanvas span={span} shift={shift} weighing={!!outcome}>
        <SliceStage
          key={`${round.kind}:${round.seed}:${attempt}`}
          object={object}
          skinColor={look.skinColor}
          stemTilt={look.stemTilt}
          outcome={outcome}
          onCut={handleCut}
          spin={stage.spin}
          cuts={stage.cuts}
          hideAfterMs={stage.blind ? BLIND_AFTER_MS : undefined}
        />
      </GameCanvas>
      <Hud
        kind={round.kind}
        seed={round.seed}
        mode={mode}
        rule={rule}
        mass={mass}
        outcome={outcome}
        newBest={newBest}
        onMode={changeMode}
        onNext={() => startRound(mode)}
        onRetry={retry}
        onHome={onExit}
        onShift={setShift}
      />
    </>
  );
}
