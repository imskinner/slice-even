/**
 * Writes a few generated apples as OBJ files so they can be inspected in
 * Blender (File > Import > Wavefront). Units are cm.
 *
 *   npm run export:apples -- [count] [seedPrefix]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findBisectingPlane, generateApple, meshToObj, meshVolume } from "../src/index.ts";

const count = Number(process.argv[2] ?? 8);
const prefix = process.argv[3] ?? "preview";
const outDir = join(import.meta.dirname, "..", "..", "..", "out", "apples");
mkdirSync(outDir, { recursive: true });

for (let i = 0; i < count; i++) {
  const seed = `${prefix}-${i}`;
  const apple = generateApple(seed);
  const mass = meshVolume(apple.mesh) * apple.density;
  const ideal = findBisectingPlane(apple.mesh, [1, 0, 0]);
  const file = join(outDir, `apple-${seed}.obj`);
  writeFileSync(file, meshToObj(apple.mesh, `apple_${seed}`));
  console.log(
    `${seed.padEnd(14)} ${mass.toFixed(1).padStart(6)} g   ideal vertical cut at x = ${ideal.point[0].toFixed(3)} cm`,
  );
}
console.log(`\nWrote ${count} OBJ files to ${outDir}`);
