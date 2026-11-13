import {
  createRng,
  cutError,
  findPlaneAtFraction,
  gramsGoal,
  meshBounds,
  meshVolume,
  OBJECT_KINDS,
  type ObjectKind,
  ruleTarget,
  scoreCut,
  scoreThirds,
  type CutResult,
  type GeneratedObject,
  type Plane,
  type RoundRule,
} from "@slice-even/core";

export interface CutOutcome {
  plane: Plane;
  /** Plane with the same direction that would have met the goal exactly. */
  ideal: Plane;
  score: CutResult;
  /** Signed distance from the ideal plane along the cut normal, cm (the worse of the two in "thirds" rounds). */
  offsetFromIdeal: number;
  /** "Thirds" rounds: the second cut and the second ideal cut. */
  plane2?: Plane;
  ideal2?: Plane;
}

/**
 * Bisection steps for the ideal cut shown on the board. Each one is a pass
 * over the whole mesh, at the moment of the cut; 26 place the line to well
 * under a micron, and the score does not depend on it.
 */
const IDEAL_ITERATIONS = 26;

/** Same math the scoring server will run. */
export function evaluateCut(object: GeneratedObject, plane: Plane, target = 0.5): CutOutcome {
  const raw = scoreCut(object.mesh, plane, object.density);
  const score = { ...raw, error: cutError(raw, target) };
  const n = plane.normal;
  const len = Math.hypot(...n);
  const offsetTo = (ideal: Plane) =>
    ((plane.point[0] - ideal.point[0]) * n[0] +
      (plane.point[1] - ideal.point[1]) * n[1] +
      (plane.point[2] - ideal.point[2]) * n[2]) /
    len;
  // For a non-half target either side may hold it: show the ideal plane nearer this cut.
  const candidates = target === 0.5 ? [0.5] : [target, 1 - target];
  const ideal = candidates
    .map((f) => findPlaneAtFraction(object.mesh, plane.normal, f, IDEAL_ITERATIONS))
    .reduce((best, p) => (Math.abs(offsetTo(p)) < Math.abs(offsetTo(best)) ? p : best));
  return { plane, ideal, score, offsetFromIdeal: offsetTo(ideal) };
}

export interface RuleInfo {
  emoji: string;
  title: string;
  /** One line telling the player what to do. */
  goal: string;
}

const pctLabel = (f: number) => `${Math.round(f * 100)}%`;

const gramsLabel = (g: number) => `${Math.round(g).toLocaleString("pt-BR")} g`;

/** `mass` is the player's own object, grams: "grams" rounds tell them what it weighs. */
export function ruleInfo(rule: RoundRule, mass?: number): RuleInfo {
  switch (rule.type) {
    case "grams":
      return mass
        ? {
            emoji: "🏷️",
            title: `Peso exato: ${gramsLabel(gramsGoal(rule.share, mass))}`,
            goal: `Este item pesa ${gramsLabel(mass)}. Corte um pedaço de ${gramsLabel(gramsGoal(rule.share, mass))}.`,
          }
        : { emoji: "🏷️", title: "Peso exato", goal: "Corte um pedaço com o peso pedido." };
    case "spin":
      return { emoji: "🌀", title: "Tábua giratória", goal: "O item gira: corte na hora certa." };
    case "thirds":
      return { emoji: "✌️", title: "Três fatias", goal: "Dois cortes, três pedaços iguais." };
    case "classic":
      return { emoji: "⚖️", title: "Clássica", goal: "Corte exatamente no meio." };
    case "target":
      return {
        emoji: "🎯",
        title: `Alvo ${pctLabel(rule.target)} / ${pctLabel(1 - rule.target)}`,
        goal: `Deixe ${pctLabel(rule.target)} do peso de um lado.`,
      };
    case "blitz":
      return { emoji: "⚡", title: "Relâmpago", goal: "Meio exato, poucos segundos!" };
    case "blind":
      return { emoji: "🙈", title: "Às cegas", goal: "Memorize: o item some em instantes." };
    case "twin":
      return { emoji: "👯", title: "Mesmo item", goal: "Todos cortam o mesmo item. Comparação direta!" };
  }
}

/** The object's weight, grams. */
export function objectMass(object: GeneratedObject): number {
  return meshVolume(object.mesh) * object.density;
}

/** Scores a "thirds" round: two parallel cuts, with the two ideal cuts for comparison. */
export function evaluateThirds(object: GeneratedObject, first: Plane, second: Plane): CutOutcome {
  const score = scoreThirds(object.mesh, first, second, object.density) ?? {
    massFront: 0,
    massBack: 0,
    massMid: 0,
    fractionFront: 0,
    error: 1,
  };
  const n = first.normal;
  const len = Math.hypot(...n);
  const along = (p: Plane) => (p.point[0] * n[0] + p.point[1] * n[1] + p.point[2] * n[2]) / len;
  // A third of the mass in front of the upper ideal cut, two thirds in front of the lower.
  const ideal = findPlaneAtFraction(object.mesh, n, 2 / 3, IDEAL_ITERATIONS);
  const ideal2 = findPlaneAtFraction(object.mesh, n, 1 / 3, IDEAL_ITERATIONS);
  const mine = [along(first), along(second)].sort((a, b) => a - b);
  const wanted = [along(ideal), along(ideal2)].sort((a, b) => a - b);
  const offsets = [mine[0]! - wanted[0]!, mine[1]! - wanted[1]!];
  return {
    plane: first,
    plane2: second,
    ideal,
    ideal2,
    score,
    offsetFromIdeal: Math.abs(offsets[0]!) > Math.abs(offsets[1]!) ? offsets[0]! : offsets[1]!,
  };
}

/** Scores a cut under any rule (the same math the server runs). */
export function evaluateRuleCut(object: GeneratedObject, rule: RoundRule, plane: Plane, plane2?: Plane): CutOutcome {
  if (rule.type === "thirds") return evaluateThirds(object, plane, plane2 ?? plane);
  return evaluateCut(object, plane, ruleTarget(rule, objectMass(object)));
}

/** Radians per second the board turns in "spin" rounds; the seed picks the direction. */
const SPIN_SPEED = 0.85;

/** What a rule changes on the board: a turning object, a second cut, a cloche. */
export function stageRule(rule: RoundRule, seed: string): { spin?: number; cuts: 1 | 2; blind: boolean } {
  const clockwise = createRng(`spin:${seed}`).next() < 0.5;
  return {
    spin: rule.type === "spin" ? (clockwise ? -SPIN_SPEED : SPIN_SPEED) : undefined,
    cuts: rule.type === "thirds" ? 2 : 1,
    blind: rule.type === "blind",
  };
}

/** Shapes for which a turning board matters (it does not for an orange): the long ones and the lumpy ones. */
export const LONG_KINDS: readonly ObjectKind[] = ["banana", "carrot", "cucumber", "bread", "eggplant", "ginger", "potato"];

/** Blind rounds hide the object this long after the round starts. */
export const BLIND_AFTER_MS = 3000;

/** Largest horizontal size of an object, cm, for camera framing. */
export function objectSpan(object: GeneratedObject): number {
  const { min, max } = meshBounds(object.mesh);
  return Math.max(max[0] - min[0], max[2] - min[2]);
}

export interface Rating {
  label: string;
  tone: "great" | "good" | "meh" | "bad";
}

export function rateError(error: number): Rating {
  if (error < 0.005) return { label: "Perfeito!", tone: "great" };
  if (error < 0.02) return { label: "Excelente", tone: "great" };
  if (error < 0.05) return { label: "Bom corte", tone: "good" };
  if (error < 0.1) return { label: "Quase", tone: "meh" };
  return { label: "Torto", tone: "bad" };
}

const APPLE_SKINS = ["#b3261e", "#8e1b1b", "#c0392b", "#7cb342", "#9ccc3c", "#d4b62c"];

/** Cosmetic per-seed variation that does not affect the score. */
export function appearanceFor(seed: string): { skinColor: string; stemTilt: number } {
  const rng = createRng(`look:${seed}`);
  return { skinColor: rng.pick(APPLE_SKINS), stemTilt: rng.range(-0.35, 0.35) };
}

export const KIND_LABELS: Record<ObjectKind, string> = {
  apple: "Maçã",
  cucumber: "Pepino",
  bread: "Pão",
  orange: "Laranja",
  tomato: "Tomate",
  banana: "Banana",
  carrot: "Cenoura",
  cake: "Bolo",
  potato: "Batata",
  ginger: "Gengibre",
  eggplant: "Berinjela",
  pepper: "Pimentão",
};

export const KIND_EMOJI: Record<ObjectKind, string> = {
  apple: "🍎",
  cucumber: "🥒",
  bread: "🍞",
  orange: "🍊",
  tomato: "🍅",
  banana: "🍌",
  carrot: "🥕",
  cake: "🎂",
  potato: "🥔",
  ginger: "🫚",
  eggplant: "🍆",
  pepper: "🫑",
};

export type KindMode = ObjectKind | "random";

export function isKindMode(value: string | null): value is KindMode {
  return value === "random" || OBJECT_KINDS.includes(value as ObjectKind);
}

export function pickKind(mode: KindMode): ObjectKind {
  return mode === "random" ? OBJECT_KINDS[Math.floor(Math.random() * OBJECT_KINDS.length)]! : mode;
}

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}
