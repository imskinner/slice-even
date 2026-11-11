import { useMemo } from "react";
import { generateObject, OBJECT_KINDS, type ObjectKind, type RoundRule } from "@slice-even/core";
import { appearanceFor, LONG_KINDS, objectMass, objectSpan, stageRule } from "./game.ts";

/**
 * One single-player object under a rule (practice and survival): everything
 * the board needs to show it and the HUD needs to describe it.
 */
export function useSoloRound(kind: ObjectKind, seed: string, rule: RoundRule) {
  const object = useMemo(() => generateObject(kind, seed), [kind, seed]);
  return useMemo(
    () => ({
      object,
      look: appearanceFor(seed),
      span: objectSpan(object),
      mass: objectMass(object),
      stage: stageRule(rule, seed),
    }),
    [object, seed, rule],
  );
}

/** A random kind that suits the rule: a turning board needs a long object. */
export function kindForRule(rule: RoundRule): ObjectKind {
  const kinds = rule.type === "spin" ? LONG_KINDS : OBJECT_KINDS;
  return kinds[Math.floor(Math.random() * kinds.length)]!;
}

const TARGETS = [0.25, 0.3, 1 / 3, 0.4];
const SHARES = [0.2, 0.25, 0.3, 0.35, 0.4];
const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!;

/** A rule by name, with a random amount where it needs one. */
export function makeRule(type: RoundRule["type"]): RoundRule {
  switch (type) {
    case "target":
      return { type, target: pick(TARGETS) };
    case "grams":
      return { type, share: pick(SHARES) };
    default:
      return { type };
  }
}

const RULE_TYPES: readonly RoundRule["type"][] = ["classic", "target", "blitz", "blind", "twin", "grams", "spin", "thirds"];

/**
 * A rule from a URL (`?rule=spin`, `?rule=target:0.25`, `?rule=grams:0.3`),
 * so a practice round under any rule can be linked to and reproduced.
 */
export function parseRule(param: string | null): RoundRule {
  const [name, amount] = (param ?? "").split(":");
  if (!RULE_TYPES.includes(name as RoundRule["type"])) return { type: "classic" };
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0.05 && value <= 0.5;
  if (name === "target") return valid ? { type: "target", target: value } : makeRule("target");
  if (name === "grams") return valid ? { type: "grams", share: value } : makeRule("grams");
  return { type: name as Exclude<RoundRule["type"], "target" | "grams"> };
}

export function ruleParam(rule: RoundRule): string {
  if (rule.type === "target") return `target:${rule.target.toFixed(3)}`;
  if (rule.type === "grams") return `grams:${rule.share}`;
  return rule.type;
}
