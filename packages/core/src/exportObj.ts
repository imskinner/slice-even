import type { Mesh } from "./mesh.ts";

/** Wavefront OBJ text, for inspecting generated shapes in Blender. */
export function meshToObj(mesh: Mesh, name = "object"): string {
  const lines = [`o ${name}`];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    lines.push(`v ${p[i]!.toFixed(5)} ${p[i + 1]!.toFixed(5)} ${p[i + 2]!.toFixed(5)}`);
  }
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    // OBJ indices are 1-based.
    lines.push(`f ${idx[t]! + 1} ${idx[t + 1]! + 1} ${idx[t + 2]! + 1}`);
  }
  return lines.join("\n") + "\n";
}
