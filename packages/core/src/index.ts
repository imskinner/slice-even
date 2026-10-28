export { createRng, type Rng } from "./rng.ts";
export { createNoise3, fbm3, type Noise3 } from "./noise.ts";
export {
  meshVolume,
  meshBounds,
  findManifoldProblems,
  vertexCount,
  triangleCount,
  type Mesh,
  type Vec3,
  type Bounds,
} from "./mesh.ts";
export { buildStarShape, type RadiusFn, type StarShapeOptions } from "./geometry/starShape.ts";
export { buildPoleGrid, type GridPosition } from "./geometry/poleGrid.ts";
export { clamp, smoothstep } from "./math.ts";
export {
  sliceVolumes,
  scoreCut,
  findBisectingPlane,
  type Plane,
  type SliceVolumes,
  type CutResult,
} from "./slice.ts";
export type { GeneratedObject } from "./generators/types.ts";
export {
  generateApple,
  buildApple,
  sampleAppleParams,
  APPLE_DENSITY,
  DEFAULT_APPLE_RESOLUTION,
  type AppleParams,
  type AppleCore,
} from "./generators/apple.ts";
export {
  generateCucumber,
  buildCucumber,
  sampleCucumberParams,
  cucumberSpine,
  cucumberBaseRadius,
  CUCUMBER_DENSITY,
  DEFAULT_CUCUMBER_RESOLUTION,
  type CucumberParams,
} from "./generators/cucumber.ts";
export {
  generateBread,
  buildBread,
  sampleBreadParams,
  breadShapeRatio,
  BREAD_DENSITY,
  DEFAULT_BREAD_RESOLUTION,
  type BreadParams,
} from "./generators/bread.ts";
export { generateOrange, ORANGE_DENSITY, type OrangeParams } from "./generators/orange.ts";
export { generateTomato, TOMATO_DENSITY, type TomatoParams } from "./generators/tomato.ts";
export { generateBanana, bananaBaseRadius, BANANA_DENSITY, type BananaParams } from "./generators/banana.ts";
export { generateCarrot, carrotBaseRadius, CARROT_DENSITY, type CarrotParams } from "./generators/carrot.ts";
export {
  generateCake,
  cakeShapeRatio,
  CAKE_DENSITY,
  type CakeParams,
  type CakeFlavor,
  type CakeFrosting,
} from "./generators/cake.ts";
export { buildHorizontalSweep, bowedSpine, roundTip, type HorizontalSweep } from "./geometry/sweep.ts";
export { generateObject, OBJECT_KINDS, type ObjectKind, type AnyGeneratedObject } from "./generators/index.ts";
export { meshToObj } from "./exportObj.ts";
export { playerSeed, parseCutPlane } from "./round.ts";
