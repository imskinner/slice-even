export const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

/** GLSL-style smoothstep; edge0 > edge1 gives the falling version. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
