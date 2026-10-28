/**
 * GLSL snippets for the procedural materials. Everything is evaluated in the
 * object's local space (cm), so the cut face shows a solid 3D texture that
 * lines up with the skin no matter where the knife went.
 */

export const NOISE_GLSL = /* glsl */ `
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

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

// Distance to the nearest random feature point (cellular noise F1).
float worley(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d = 8.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(x, y, z);
    vec3 o = vec3(hash13(i + g), hash13(i + g + 17.1), hash13(i + g + 31.7));
    vec3 r = g + o - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
`;

/* ---------------------------------- apple --------------------------------- */

export const APPLE_UNIFORMS = /* glsl */ `
uniform vec3 uSkin;
uniform vec2 uLean;
uniform float uCoreRadius;
uniform float uCoreHeight;
uniform float uCoreY;
uniform float uCoreRotation;
uniform float uSeedDistance;
uniform float uSeeds[5];
`;

export const APPLE_SKIN = /* glsl */ `
vec3 surfaceColor(vec3 p) {
  float ang = atan(p.z, p.x);
  // Vertical streaks of a lighter tone, plus a paler patch where the sun did not reach.
  float streak = vnoise(vec3(ang * 6.0, p.y * 0.35, 0.0));
  vec3 col = mix(uSkin, uSkin * vec3(1.25, 1.15, 0.85), smoothstep(0.45, 0.9, streak) * 0.45);
  col = mix(col, mix(uSkin, vec3(0.85, 0.75, 0.35), 0.5), smoothstep(0.55, 0.8, fbm(p * 0.35 + 4.0)) * 0.6);
  // Lenticels: tiny pale dots.
  float dots = smoothstep(0.12, 0.06, worley(p * 4.0));
  return mix(col, vec3(0.95, 0.88, 0.65), dots * 0.35);
}
`;

export const APPLE_FLESH = /* glsl */ `
vec3 surfaceColor(vec3 p) {
  vec2 q = p.xz - uLean * p.y;
  float r = length(q);
  float ang = atan(q.y, q.x);
  float y = p.y - uCoreY;

  vec3 col = vec3(0.97, 0.93, 0.77) * (0.96 + 0.06 * vnoise(p * 7.0));

  // Five-pointed core, outlined by the carpel wall.
  float coreR = uCoreRadius * (0.8 + 0.2 * cos(5.0 * (ang - uCoreRotation)));
  float e = length(vec2(r / coreR, y / uCoreHeight));
  col = mix(col, vec3(0.94, 0.9, 0.72), smoothstep(1.05, 0.95, e));
  col = mix(col, vec3(0.78, 0.74, 0.5), smoothstep(0.07, 0.0, abs(e - 1.0)) * 0.8);

  // Fibrous channel from stem to calyx along the axis.
  col = mix(col, vec3(0.86, 0.82, 0.6), smoothstep(0.2, 0.08, r) * 0.6);

  for (int k = 0; k < 5; k++) {
    if (uSeeds[k] < 0.5) continue;
    float a = uCoreRotation + float(k) * 1.2566;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 d = q - dir * uSeedDistance;
    float radial = dot(d, dir);
    float tang = dot(d, vec2(-dir.y, dir.x));
    // Papery pocket around the seed.
    float pocket = length(vec3(radial / 0.42, y / 0.62, tang / 0.3));
    col = mix(col, vec3(0.9, 0.87, 0.76), smoothstep(1.05, 0.95, pocket));
    // Teardrop seed, pointed end up.
    float yy = y + 0.05;
    float w = 1.0 + 0.35 * clamp(-yy / 0.45, -1.0, 1.0);
    float seed = length(vec3(radial / (0.26 * w), yy / 0.45, tang / (0.16 * w)));
    vec3 seedCol = mix(vec3(0.45, 0.26, 0.11), vec3(0.2, 0.1, 0.04), smoothstep(0.1, 1.0, seed));
    col = mix(col, seedCol, smoothstep(1.0, 0.88, seed));
  }
  return col;
}
`;

/* -------------------------------- cucumber -------------------------------- */

export const CUCUMBER_UNIFORMS = /* glsl */ `
uniform float uLength;
uniform float uBend;
uniform float uRadius;
uniform float uCap;
uniform float uTaper;
uniform float uSeedRotation;

// (s along the spine 0..1, distance from spine / smooth radius, angle around).
// Mirrors cucumberSpine and cucumberBaseRadius in core, approximating the
// closest spine point by x (the spine's x is linear in s).
vec3 cucumberCoords(vec3 p) {
  float s = clamp((p.x + uLength * 0.5) / uLength, 0.0, 1.0);
  vec2 v = vec2(p.z - 4.0 * uBend * s * (1.0 - s), p.y);
  float u = min(s, 1.0 - s) * uLength;
  float tip = u < uCap ? sqrt(max(0.0, 1.0 - pow(1.0 - u / uCap, 2.0))) : 1.0;
  float R = uRadius * tip * (1.0 + uTaper * (s - 0.5));
  return vec3(s, length(v) / max(R, 1e-3), atan(v.y, v.x));
}
`;

export const CUCUMBER_SKIN = /* glsl */ `
vec3 surfaceColor(vec3 p) {
  vec3 c = cucumberCoords(p);
  float stripe = 0.5 + 0.5 * sin(c.z * 7.0 + 3.0 * fbm(p * vec3(0.15, 0.8, 0.8)));
  vec3 col = mix(vec3(0.12, 0.28, 0.07), vec3(0.3, 0.48, 0.15), smoothstep(0.55, 0.95, stripe));
  col *= 0.85 + 0.3 * vnoise(p * 3.0);
  // Paler, yellowish tips.
  float tip = smoothstep(0.08, 0.0, min(c.x, 1.0 - c.x));
  return mix(col, vec3(0.55, 0.6, 0.25), tip * 0.6);
}
`;

export const CUCUMBER_FLESH = /* glsl */ `
vec3 surfaceColor(vec3 p) {
  vec3 c = cucumberCoords(p);
  float rr = c.y;
  float a = c.z;
  vec3 col = vec3(0.86, 0.93, 0.72) * (0.97 + 0.05 * vnoise(p * 8.0));
  col = mix(col, vec3(0.62, 0.8, 0.45), smoothstep(0.72, 0.92, rr));
  col = mix(col, vec3(0.18, 0.4, 0.12), smoothstep(0.93, 0.985, rr));

  // Three-lobed seed cavity filled with greener jelly.
  float lobe = 0.42 + 0.1 * cos(3.0 * (a - uSeedRotation));
  col = mix(col, vec3(0.74, 0.86, 0.56), smoothstep(lobe + 0.03, lobe - 0.03, rr) * 0.8);
  col = mix(col, vec3(0.84, 0.91, 0.68), smoothstep(0.06, 0.0, rr) * 0.5);

  vec2 pp = rr * vec2(cos(a), sin(a));
  for (int k = 0; k < 3; k++) {
    for (int side = -1; side <= 1; side += 2) {
      float sa = uSeedRotation + float(k) * 2.0944 + float(side) * 0.42;
      vec2 dir = vec2(cos(sa), sin(sa));
      vec2 d = pp - dir * 0.27;
      // Seeds repeat along the length; a cut shows each at a random phase.
      float along = fract(c.x * uLength / 0.7 + hash13(vec3(float(k), float(side), 3.0))) - 0.5;
      float size = sqrt(max(0.0, 1.0 - pow(along / 0.38, 2.0)));
      float seed = length(vec2(dot(d, vec2(-dir.y, dir.x)) / 0.055, dot(d, dir) / 0.1)) / max(size, 1e-3);
      col = mix(col, vec3(0.97, 0.97, 0.86), smoothstep(1.0, 0.8, seed));
    }
  }
  return col;
}
`;

/* ---------------------------------- bread --------------------------------- */

export const BREAD_UNIFORMS = /* glsl */ `
uniform float uLengthPos;
uniform float uLengthNeg;
uniform float uHeightTop;
uniform float uHeightBottom;
uniform float uWidth;
uniform float uExpTop;
uniform float uExpBottom;
uniform float uExpFootprint;
uniform float uSlope;

// Mirrors breadShapeRatio in core: 1 on the smooth surface, < 1 inside.
float breadRatio(vec3 p) {
  float len = max(length(p), 1e-4);
  float a = p.x > 0.0 ? uLengthPos : uLengthNeg;
  float b = p.y > 0.0 ? uHeightTop * (1.0 + uSlope * p.x / len) : uHeightBottom;
  float e = p.y > 0.0 ? uExpTop : uExpBottom;
  float h = uExpFootprint;
  float footprint = pow(pow(abs(p.x / a), h) + pow(abs(p.z / uWidth), h), 1.0 / h);
  return pow(pow(footprint, e) + pow(abs(p.y / b), e), 1.0 / e);
}
`;

export const BREAD_CRUST = /* glsl */ `
vec3 surfaceColor(vec3 p) {
  float h = clamp((p.y + uHeightBottom) / (uHeightTop + uHeightBottom), 0.0, 1.0);
  vec3 col = mix(vec3(0.74, 0.5, 0.24), vec3(0.5, 0.27, 0.09), smoothstep(0.35, 1.0, h));
  col *= 0.85 + 0.25 * fbm(p * 1.5);
  // The slashes open up into paler, less baked crumb.
  col = mix(col, vec3(0.88, 0.7, 0.42), smoothstep(0.95, 0.9, breadRatio(p)));
  // A dusting of flour on top.
  float flour = smoothstep(0.62, 0.8, fbm(p * 1.2 + 7.0)) * smoothstep(0.7, 1.0, h);
  return mix(col, vec3(0.94, 0.9, 0.8), flour * 0.35);
}
`;

export const BREAD_CRUMB = /* glsl */ `
vec3 surfaceColor(vec3 p) {
  vec3 col = vec3(0.97, 0.86, 0.6) * (0.93 + 0.1 * vnoise(p * 12.0));
  // Air pockets: many small ones and a few big, stretched ones.
  float small = smoothstep(0.3, 0.16, worley(p * 1.8));
  float big = smoothstep(0.22, 0.1, worley(p * vec3(0.6, 0.9, 0.7) + 11.0));
  col = mix(col, vec3(0.78, 0.6, 0.36), max(small * 0.75, big * 0.9));
  // Crust band, about 3–4 mm thick.
  float size = min(min(uWidth, uHeightTop), 0.5 * (uLengthPos + uLengthNeg));
  float crust = smoothstep(1.0 - 0.45 / size, 1.0 - 0.3 / size, breadRatio(p));
  return mix(col, vec3(0.6, 0.35, 0.13), crust);
}
`;
