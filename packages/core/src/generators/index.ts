import { generateApple, type AppleParams } from "./apple.ts";
import { generateBread, type BreadParams } from "./bread.ts";
import { generateCucumber, type CucumberParams } from "./cucumber.ts";
import type { GeneratedObject } from "./types.ts";

export type AnyGeneratedObject =
  | GeneratedObject<"apple", AppleParams>
  | GeneratedObject<"cucumber", CucumberParams>
  | GeneratedObject<"bread", BreadParams>;

export type ObjectKind = AnyGeneratedObject["kind"];

export const OBJECT_KINDS: readonly ObjectKind[] = ["apple", "cucumber", "bread"];

export function generateObject(kind: ObjectKind, seed: string): AnyGeneratedObject {
  switch (kind) {
    case "apple":
      return generateApple(seed);
    case "cucumber":
      return generateCucumber(seed);
    case "bread":
      return generateBread(seed);
  }
}
