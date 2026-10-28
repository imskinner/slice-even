import type { StarShapeOptions } from "../geometry/starShape.ts";
import { DEFAULT_APPLE_RESOLUTION, generateApple, type AppleParams } from "./apple.ts";
import { DEFAULT_BANANA_RESOLUTION, generateBanana, type BananaParams } from "./banana.ts";
import { DEFAULT_BREAD_RESOLUTION, generateBread, type BreadParams } from "./bread.ts";
import { DEFAULT_CAKE_RESOLUTION, generateCake, type CakeParams } from "./cake.ts";
import { DEFAULT_CARROT_RESOLUTION, generateCarrot, type CarrotParams } from "./carrot.ts";
import { DEFAULT_CUCUMBER_RESOLUTION, generateCucumber, type CucumberParams } from "./cucumber.ts";
import { DEFAULT_ORANGE_RESOLUTION, generateOrange, type OrangeParams } from "./orange.ts";
import { DEFAULT_TOMATO_RESOLUTION, generateTomato, type TomatoParams } from "./tomato.ts";
import type { GeneratedObject } from "./types.ts";

export type AnyGeneratedObject =
  | GeneratedObject<"apple", AppleParams>
  | GeneratedObject<"cucumber", CucumberParams>
  | GeneratedObject<"bread", BreadParams>
  | GeneratedObject<"orange", OrangeParams>
  | GeneratedObject<"tomato", TomatoParams>
  | GeneratedObject<"banana", BananaParams>
  | GeneratedObject<"carrot", CarrotParams>
  | GeneratedObject<"cake", CakeParams>;

export type ObjectKind = AnyGeneratedObject["kind"];

type Generator = (seed: string, resolution: StarShapeOptions) => AnyGeneratedObject;

const GENERATORS: Record<ObjectKind, [Generator, StarShapeOptions]> = {
  apple: [generateApple, DEFAULT_APPLE_RESOLUTION],
  cucumber: [generateCucumber, DEFAULT_CUCUMBER_RESOLUTION],
  bread: [generateBread, DEFAULT_BREAD_RESOLUTION],
  orange: [generateOrange, DEFAULT_ORANGE_RESOLUTION],
  tomato: [generateTomato, DEFAULT_TOMATO_RESOLUTION],
  banana: [generateBanana, DEFAULT_BANANA_RESOLUTION],
  carrot: [generateCarrot, DEFAULT_CARROT_RESOLUTION],
  cake: [generateCake, DEFAULT_CAKE_RESOLUTION],
};

export const OBJECT_KINDS = Object.keys(GENERATORS) as readonly ObjectKind[];

/**
 * `quality: "preview"` halves the mesh resolution, for decorative copies
 * (the home screen). Scoring always uses the full resolution.
 */
export function generateObject(kind: ObjectKind, seed: string, quality: "full" | "preview" = "full"): AnyGeneratedObject {
  const [generate, resolution] = GENERATORS[kind];
  const res =
    quality === "full"
      ? resolution
      : { rings: Math.max(8, Math.round(resolution.rings / 2)), segments: Math.max(8, Math.round(resolution.segments / 2)) };
  return generate(seed, res);
}
