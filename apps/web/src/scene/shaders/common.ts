import type * as THREE from "three";

/**
 * Procedural materials are written per kind as GLSL bodies evaluated in the
 * object's local space (cm), so cut faces show a solid 3D texture that lines
 * up with the skin wherever the knife went.
 *
 * A body must define:
 *   vec3  surfaceColor(vec3 p)    sRGB albedo
 *   float surfaceHeight(vec3 p)   bump height in cm (relief without geometry)
 * and may define:
 *   float surfaceRoughness(vec3 p, float base)
 */
export interface ShaderPart {
  body: string;
  /** Multiplier for surfaceHeight. */
  bump: number;
  material: THREE.MeshPhysicalMaterialParameters;
}

export interface KindShader {
  /** Uniform declarations and helpers shared by skin and flesh. */
  declarations: string;
  uniforms: Record<string, unknown>;
  skin: ShaderPart;
  flesh: ShaderPart;
  /** Color of the juice / crumbs that fly when it is cut. */
  splash: string;
}

export const NOISE_GLSL = /* glsl */ `
vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// Value noise in [0, 1].
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s / 0.9375;
}

// Cellular noise: distance to the nearest feature point (F1) and the id of that cell.
vec2 worleyId(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d = 8.0;
  float id = 0.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(x, y, z);
    vec3 o = vec3(hash13(i + g), hash13(i + g + 17.1), hash13(i + g + 31.7));
    vec3 r = g + o - f;
    float dd = dot(r, r);
    if (dd < d) { d = dd; id = hash13(i + g + 7.7); }
  }
  return vec2(sqrt(d), id);
}

float worley(vec3 p) { return worleyId(p).x; }

// PI comes from three's shader chunks.
const float TAU = 6.2831853;

// Radius of the quarter-ellipse tip used by core's roundTip.
float roundTip(float distanceFromEnd, float capLength) {
  if (distanceFromEnd >= capLength) return 1.0;
  float t = 1.0 - distanceFromEnd / capLength;
  return sqrt(max(0.0, 1.0 - t * t));
}
`;

/** Perturbs the shading normal by the screen-space gradient of a height field. */
export const BUMP_GLSL = /* glsl */ `
vec3 bumpNormal(vec3 n, float h, float scale) {
  vec3 dpdx = dFdx(-vViewPosition);
  vec3 dpdy = dFdy(-vViewPosition);
  float dhx = dFdx(h);
  float dhy = dFdy(h);
  vec3 r1 = cross(dpdy, n);
  vec3 r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - scale * grad);
}
`;
