import type { Mesh } from "../mesh.ts";

export interface GeneratedObject<Kind extends string = string, Params = unknown> {
  kind: Kind;
  seed: string;
  /** The random parameters that were drawn, kept for debugging and replays. */
  params: Params;
  /** g/cm³. Uniform for now; a density field can replace this later. */
  density: number;
  mesh: Mesh;
}
