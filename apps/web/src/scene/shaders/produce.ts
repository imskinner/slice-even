import * as THREE from "three";
import type { AnyGeneratedObject } from "@slice-even/core";
import type { KindShader } from "./common.ts";

/* Per-kind GLSL. Each declarations block mirrors the matching generator in
   core closely enough to find the skin, rind or frosting from inside. */

const srgb = (hex: string) => new THREE.Color(hex).convertLinearToSRGB();

/* ---------------------------------------------------------------- apple */

function apple(object: Extract<AnyGeneratedObject, { kind: "apple" }>, skinColor: string): KindShader {
  const { core, lean, heightRatio } = object.params;
  return {
    splash: "#f5e7a6",
    uniforms: {
      uSkin: srgb(skinColor),
      uLean: new THREE.Vector2(lean.x, lean.z),
      uCoreRadius: core.radius,
      uCoreHeight: core.height * heightRatio,
      uCoreY: core.offsetY * heightRatio,
      uCoreRotation: core.rotation,
      uSeedDistance: core.seedDistance,
      uSeeds: core.seeds.map((s) => (s ? 1 : 0)),
    },
    declarations: /* glsl */ `
      uniform vec3 uSkin;
      uniform vec2 uLean;
      uniform float uCoreRadius, uCoreHeight, uCoreY, uCoreRotation, uSeedDistance;
      uniform float uSeeds[5];
    `,
    skin: {
      bump: 1,
      material: { roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.3 },
      body: /* glsl */ `
        vec3 surfaceColor(vec3 p) {
          float ang = atan(p.z, p.x);
          float streak = vnoise(vec3(ang * 7.0, p.y * 0.4, 0.0));
          vec3 col = mix(uSkin, uSkin * vec3(1.3, 1.15, 0.8), smoothstep(0.4, 0.9, streak) * 0.5);
          col = mix(col, mix(uSkin, vec3(0.9, 0.78, 0.35), 0.55), smoothstep(0.55, 0.85, fbm(p * 0.35 + 4.0)) * 0.6);
          // Russet around the stem cavity.
          col = mix(col, vec3(0.55, 0.45, 0.2), smoothstep(0.6, 0.95, p.y / max(length(p), 1e-3)) * 0.5 * fbm(p * 2.0));
          float dots = smoothstep(0.12, 0.05, worley(p * 4.0));
          return mix(col, vec3(0.97, 0.9, 0.68), dots * 0.45);
        }
        float surfaceHeight(vec3 p) {
          return 0.012 * fbm(p * 3.0) - 0.015 * smoothstep(0.12, 0.04, worley(p * 4.0));
        }
      `,
    },
    flesh: {
      bump: 1,
      material: { roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.5 },
      body: /* glsl */ `
        float seedMask(vec3 p, out float pocketMask) {
          vec2 q = p.xz - uLean * p.y;
          float y = p.y - uCoreY;
          float best = 0.0;
          pocketMask = 0.0;
          for (int k = 0; k < 5; k++) {
            if (uSeeds[k] < 0.5) continue;
            float a = uCoreRotation + float(k) * 1.2566;
            vec2 dir = vec2(cos(a), sin(a));
            vec2 d = q - dir * uSeedDistance;
            float radial = dot(d, dir);
            float tang = dot(d, vec2(-dir.y, dir.x));
            pocketMask = max(pocketMask, smoothstep(1.05, 0.95, length(vec3(radial / 0.42, y / 0.62, tang / 0.3))));
            float yy = y + 0.05;
            float w = 1.0 + 0.35 * clamp(-yy / 0.45, -1.0, 1.0);
            best = max(best, smoothstep(1.0, 0.85, length(vec3(radial / (0.26 * w), yy / 0.45, tang / (0.16 * w)))));
          }
          return best;
        }
        vec3 surfaceColor(vec3 p) {
          vec2 q = p.xz - uLean * p.y;
          float r = length(q);
          float ang = atan(q.y, q.x);
          float y = p.y - uCoreY;
          vec3 col = vec3(0.98, 0.94, 0.78) * (0.95 + 0.08 * vnoise(p * 7.0));
          float coreR = uCoreRadius * (0.8 + 0.2 * cos(5.0 * (ang - uCoreRotation)));
          float e = length(vec2(r / coreR, y / uCoreHeight));
          col = mix(col, vec3(0.95, 0.91, 0.72), smoothstep(1.05, 0.95, e));
          col = mix(col, vec3(0.78, 0.74, 0.48), smoothstep(0.07, 0.0, abs(e - 1.0)) * 0.85);
          col = mix(col, vec3(0.87, 0.83, 0.6), smoothstep(0.2, 0.08, r) * 0.6);
          // Faint vascular ring around the core.
          col = mix(col, vec3(0.86, 0.84, 0.62), smoothstep(0.05, 0.0, abs(e - 1.9)) * 0.5);
          float pocket;
          float seed = seedMask(p, pocket);
          col = mix(col, vec3(0.92, 0.89, 0.78), pocket);
          vec3 seedCol = mix(vec3(0.5, 0.28, 0.12), vec3(0.2, 0.1, 0.04), seed);
          return mix(col, seedCol, seed);
        }
        float surfaceHeight(vec3 p) {
          float pocket;
          float seed = seedMask(p, pocket);
          return 0.01 * vnoise(p * 12.0) - 0.04 * pocket + 0.05 * seed;
        }
        float surfaceRoughness(vec3 p, float base) {
          float pocket;
          return mix(base, 0.2, seedMask(p, pocket));
        }
      `,
    },
  };
}

/* ---------------------------------------------------------------- cucumber */

function cucumber(object: Extract<AnyGeneratedObject, { kind: "cucumber" }>): KindShader {
  const p = object.params;
  return {
    splash: "#c4e48a",
    uniforms: {
      uLength: p.length,
      uBend: p.bend,
      uRadius: p.radius,
      uCap: p.capLength,
      uTaper: p.taper,
      uSeedRotation: p.seedRotation,
    },
    declarations: /* glsl */ `
      uniform float uLength, uBend, uRadius, uCap, uTaper, uSeedRotation;
      // (s along the spine, distance from spine / smooth radius, angle around).
      vec3 cucumberCoords(vec3 p) {
        float s = clamp((p.x + uLength * 0.5) / uLength, 0.0, 1.0);
        vec2 v = vec2(p.z - 4.0 * uBend * s * (1.0 - s), p.y);
        float R = uRadius * roundTip(min(s, 1.0 - s) * uLength, uCap) * (1.0 + uTaper * (s - 0.5));
        return vec3(s, length(v) / max(R, 1e-3), atan(v.y, v.x));
      }
    `,
    skin: {
      bump: 1,
      material: { roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.35 },
      body: /* glsl */ `
        vec3 surfaceColor(vec3 p) {
          vec3 c = cucumberCoords(p);
          float stripe = 0.5 + 0.5 * sin(c.z * 7.0 + 3.0 * fbm(p * vec3(0.15, 0.8, 0.8)));
          vec3 col = mix(vec3(0.1, 0.26, 0.06), vec3(0.32, 0.5, 0.15), smoothstep(0.55, 0.95, stripe));
          col *= 0.85 + 0.3 * vnoise(p * 3.0);
          float wart = smoothstep(0.22, 0.05, worley(p * 1.4));
          col = mix(col, vec3(0.55, 0.65, 0.3), wart * 0.5);
          return mix(col, vec3(0.6, 0.62, 0.25), smoothstep(0.08, 0.0, min(c.x, 1.0 - c.x)) * 0.6);
        }
        float surfaceHeight(vec3 p) {
          return 0.06 * smoothstep(0.25, 0.0, worley(p * 1.4)) + 0.01 * vnoise(p * 6.0);
        }
      `,
    },
    flesh: {
      bump: 1,
      material: { roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 },
      body: /* glsl */ `
        float cucumberSeeds(vec3 c) {
          vec2 pp = c.y * vec2(cos(c.z), sin(c.z));
          float best = 0.0;
          for (int k = 0; k < 3; k++) {
            for (int side = -1; side <= 1; side += 2) {
              float sa = uSeedRotation + float(k) * 2.0944 + float(side) * 0.42;
              vec2 dir = vec2(cos(sa), sin(sa));
              vec2 d = pp - dir * 0.27;
              float along = fract(c.x * uLength / 0.7 + hash13(vec3(float(k), float(side), 3.0))) - 0.5;
              float size = sqrt(max(0.0, 1.0 - pow(along / 0.38, 2.0)));
              float seed = length(vec2(dot(d, vec2(-dir.y, dir.x)) / 0.055, dot(d, dir) / 0.1)) / max(size, 1e-3);
              best = max(best, smoothstep(1.0, 0.8, seed));
            }
          }
          return best;
        }
        vec3 surfaceColor(vec3 p) {
          vec3 c = cucumberCoords(p);
          float rr = c.y;
          vec3 col = vec3(0.86, 0.94, 0.7) * (0.96 + 0.06 * vnoise(p * 8.0));
          col = mix(col, vec3(0.6, 0.8, 0.42), smoothstep(0.72, 0.92, rr));
          col = mix(col, vec3(0.15, 0.36, 0.1), smoothstep(0.93, 0.985, rr));
          float lobe = 0.42 + 0.1 * cos(3.0 * (c.z - uSeedRotation));
          col = mix(col, vec3(0.72, 0.86, 0.52), smoothstep(lobe + 0.03, lobe - 0.03, rr) * 0.8);
          return mix(col, vec3(0.97, 0.97, 0.86), cucumberSeeds(c));
        }
        float surfaceHeight(vec3 p) {
          vec3 c = cucumberCoords(p);
          return 0.03 * cucumberSeeds(c) + 0.008 * vnoise(p * 10.0);
        }
      `,
    },
  };
}

/* ---------------------------------------------------------------- bread */

function bread(object: Extract<AnyGeneratedObject, { kind: "bread" }>): KindShader {
  const p = object.params;
  return {
    splash: "#d8a868",
    uniforms: {
      uLengthPos: p.lengthPos,
      uLengthNeg: p.lengthNeg,
      uHeightTop: p.heightTop,
      uHeightBottom: p.heightBottom,
      uWidth: p.width,
      uExpTop: p.exponentTop,
      uExpBottom: p.exponentBottom,
      uExpFootprint: p.exponentFootprint,
      uSlope: p.slope,
    },
    declarations: /* glsl */ `
      uniform float uLengthPos, uLengthNeg, uHeightTop, uHeightBottom, uWidth;
      uniform float uExpTop, uExpBottom, uExpFootprint, uSlope;
      float breadRatio(vec3 p) {
        float len = max(length(p), 1e-4);
        float a = p.x > 0.0 ? uLengthPos : uLengthNeg;
        float b = p.y > 0.0 ? uHeightTop * (1.0 + uSlope * p.x / len) : uHeightBottom;
        float e = p.y > 0.0 ? uExpTop : uExpBottom;
        float h = uExpFootprint;
        float footprint = pow(pow(abs(p.x / a), h) + pow(abs(p.z / uWidth), h), 1.0 / h);
        return pow(pow(footprint, e) + pow(abs(p.y / b), e), 1.0 / e);
      }
    `,
    skin: {
      bump: 1,
      material: { roughness: 0.8, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color("#fff2d8") },
      body: /* glsl */ `
        vec3 surfaceColor(vec3 p) {
          float h = clamp((p.y + uHeightBottom) / (uHeightTop + uHeightBottom), 0.0, 1.0);
          vec3 col = mix(vec3(0.78, 0.53, 0.25), vec3(0.48, 0.25, 0.08), smoothstep(0.35, 1.0, h));
          col *= 0.8 + 0.35 * fbm(p * 1.5);
          col = mix(col, vec3(0.9, 0.72, 0.43), smoothstep(0.95, 0.9, breadRatio(p)));
          float flour = smoothstep(0.62, 0.8, fbm(p * 1.2 + 7.0)) * smoothstep(0.7, 1.0, h);
          return mix(col, vec3(0.95, 0.91, 0.82), flour * 0.4);
        }
        float surfaceHeight(vec3 p) {
          // Crackled crust.
          return 0.12 * fbm(p * 1.1) + 0.05 * smoothstep(0.0, 0.15, worley(p * 1.8));
        }
      `,
    },
    flesh: {
      bump: 1,
      material: { roughness: 0.95 },
      body: /* glsl */ `
        float crumbHoles(vec3 p) {
          float small = smoothstep(0.3, 0.14, worley(p * 1.8));
          float big = smoothstep(0.22, 0.08, worley(p * vec3(0.6, 0.9, 0.7) + 11.0));
          return max(small * 0.75, big);
        }
        float crustBand(vec3 p) {
          float size = min(min(uWidth, uHeightTop), 0.5 * (uLengthPos + uLengthNeg));
          return smoothstep(1.0 - 0.45 / size, 1.0 - 0.3 / size, breadRatio(p));
        }
        vec3 surfaceColor(vec3 p) {
          vec3 col = vec3(0.98, 0.87, 0.6) * (0.92 + 0.12 * vnoise(p * 12.0));
          col = mix(col, vec3(0.74, 0.56, 0.32), crumbHoles(p));
          return mix(col, vec3(0.58, 0.33, 0.12), crustBand(p));
        }
        float surfaceHeight(vec3 p) {
          return -0.12 * crumbHoles(p) + 0.02 * vnoise(p * 14.0);
        }
      `,
    },
  };
}

/* ---------------------------------------------------------------- orange */

function orange(object: Extract<AnyGeneratedObject, { kind: "orange" }>): KindShader {
  const p = object.params;
  return {
    splash: "#ffa526",
    uniforms: {
      uRadius: p.radius,
      uHeightRatio: p.heightRatio,
      uSegments: p.segments,
      uSegRotation: p.segmentRotation,
      uRind: p.rind,
    },
    declarations: /* glsl */ `
      uniform float uRadius, uHeightRatio, uSegments, uSegRotation, uRind;
      // Depth below the peel, cm, from an ellipsoid fit (the shape is nearly one).
      float orangeDepth(vec3 p) {
        return uRadius - length(vec3(p.x, p.y / uHeightRatio, p.z));
      }
    `,
    skin: {
      bump: 1,
      material: { roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45 },
      body: /* glsl */ `
        float pores(vec3 p) { return smoothstep(0.32, 0.0, worley(p * 3.4)); }
        vec3 surfaceColor(vec3 p) {
          vec3 col = mix(vec3(0.98, 0.52, 0.06), vec3(1.0, 0.64, 0.12), fbm(p * 0.8));
          col *= 0.94 + 0.08 * pores(p);
          // Green-brown stem scar at the top.
          float top = smoothstep(0.985, 0.998, p.y / max(length(p), 1e-3));
          return mix(col, vec3(0.35, 0.35, 0.1), top);
        }
        float surfaceHeight(vec3 p) { return -0.035 * pores(p) + 0.01 * vnoise(p * 6.0); }
      `,
    },
    flesh: {
      bump: 1,
      material: { roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 },
      body: /* glsl */ `
        // 0 inside a segment, 1 on a membrane between segments.
        float membrane(vec3 p) {
          float a = atan(p.z, p.x) / TAU * uSegments + uSegRotation;
          float edge = abs(fract(a) - 0.5) * 2.0;
          float r = length(p.xz);
          // Membranes are thin in absolute terms: wider in angle near the axis.
          return smoothstep(1.0 - 0.06 / max(r, 0.3), 1.0, edge);
        }
        float vesicles(vec3 p) {
          float r = length(p.xz);
          float a = atan(p.z, p.x);
          // Juice sacs are long and point outwards: stretch the cells radially.
          return worley(vec3(r * 1.6, a * 6.0, p.y * 4.0));
        }
        vec3 surfaceColor(vec3 p) {
          float depth = orangeDepth(p);
          float r = length(p.xz);
          vec3 col = mix(vec3(1.0, 0.55, 0.05), vec3(1.0, 0.72, 0.2), smoothstep(0.1, 0.5, vesicles(p)));
          col = mix(col, vec3(1.0, 0.95, 0.82), membrane(p) * 0.9);
          col = mix(col, vec3(1.0, 0.95, 0.84), smoothstep(0.35, 0.2, r));
          // Pith (white) and peel (orange) bands.
          col = mix(col, vec3(1.0, 0.96, 0.85), smoothstep(uRind + 0.05, uRind - 0.05, depth));
          return mix(col, vec3(0.98, 0.52, 0.06), smoothstep(0.16, 0.1, depth));
        }
        float surfaceHeight(vec3 p) {
          float depth = orangeDepth(p);
          float pulp = smoothstep(uRind - 0.05, uRind + 0.05, depth);
          return pulp * (0.04 * smoothstep(0.1, 0.5, vesicles(p)) - 0.05 * membrane(p));
        }
        float surfaceRoughness(vec3 p, float base) {
          return mix(0.85, base, smoothstep(uRind - 0.05, uRind + 0.05, orangeDepth(p)));
        }
      `,
    },
  };
}

/* ---------------------------------------------------------------- tomato */

function tomato(object: Extract<AnyGeneratedObject, { kind: "tomato" }>): KindShader {
  const p = object.params;
  return {
    splash: "#e8341f",
    uniforms: {
      uRadius: p.radius,
      uHeightRatio: p.heightRatio,
      uLobes: p.lobes.count,
      uLobePhase: p.lobes.phase,
      uWall: p.wall,
    },
    declarations: /* glsl */ `
      uniform float uRadius, uHeightRatio, uLobes, uLobePhase, uWall;
      float tomatoDepth(vec3 p) { return uRadius - length(vec3(p.x, p.y / uHeightRatio, p.z)); }
    `,
    skin: {
      bump: 1,
      material: { roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12 },
      body: /* glsl */ `
        vec3 surfaceColor(vec3 p) {
          vec3 col = mix(vec3(0.85, 0.12, 0.06), vec3(0.95, 0.25, 0.08), fbm(p * 0.7));
          // Unripe shoulders around the stem.
          float shoulder = smoothstep(0.7, 0.95, p.y / max(length(p), 1e-3));
          return mix(col, vec3(0.9, 0.55, 0.12), shoulder * 0.6);
        }
        float surfaceHeight(vec3 p) { return 0.004 * fbm(p * 4.0); }
      `,
    },
    flesh: {
      bump: 1,
      material: { roughness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.1 },
      body: /* glsl */ `
        // 1 inside a seed chamber (gel), 0 in the walls and septa.
        float chamber(vec3 p) {
          float depth = tomatoDepth(p);
          float r = length(p.xz);
          float a = atan(p.z, p.x);
          // Chambers centered on the lobes: n*phi + phase = 2*pi*k.
          float k = fract((a * uLobes + uLobePhase) / TAU + 0.5) - 0.5;
          float septum = smoothstep(0.38, 0.44, abs(k));
          float inside = smoothstep(uWall - 0.05, uWall + 0.1, depth) * smoothstep(0.55, 0.85, r);
          return inside * (1.0 - septum);
        }
        float seeds(vec3 p) {
          vec2 w = worleyId(p * 3.0);
          return smoothstep(0.25, 0.12, w.x) * step(0.4, w.y);
        }
        vec3 surfaceColor(vec3 p) {
          float depth = tomatoDepth(p);
          float r = length(p.xz);
          vec3 col = vec3(0.9, 0.22, 0.12) * (0.92 + 0.1 * vnoise(p * 6.0));
          col = mix(col, vec3(0.98, 0.45, 0.32), smoothstep(0.9, 0.4, r));
          float gel = chamber(p);
          col = mix(col, vec3(0.97, 0.62, 0.32), gel);
          col = mix(col, vec3(0.98, 0.9, 0.55), gel * seeds(p));
          return mix(col, vec3(0.8, 0.1, 0.05), smoothstep(0.08, 0.02, depth));
        }
        float surfaceHeight(vec3 p) {
          float gel = chamber(p);
          return -0.08 * gel + 0.04 * gel * seeds(p) + 0.006 * vnoise(p * 10.0);
        }
        float surfaceRoughness(vec3 p, float base) { return mix(base, 0.08, chamber(p)); }
      `,
    },
  };
}

/* ---------------------------------------------------------------- banana */

function banana(object: Extract<AnyGeneratedObject, { kind: "banana" }>): KindShader {
  const p = object.params;
  return {
    splash: "#f6ecc6",
    uniforms: {
      uLength: p.length,
      uRadius: p.radius,
      uBend: p.bend,
      uNeck: p.neck,
      uBelly: p.belly,
      uFacets: p.facets.count,
      uFacetRotation: p.facets.rotation,
    },
    declarations: /* glsl */ `
      uniform float uLength, uRadius, uBend, uNeck, uBelly, uFacets, uFacetRotation;
      vec3 bananaCoords(vec3 p) {
        float s = clamp((p.x + uLength * 0.5) / uLength, 0.0, 1.0);
        vec2 v = vec2(p.z - 4.0 * uBend * s * (1.0 - s), p.y);
        float stem = 0.22 + 0.78 * smoothstep(0.0, uNeck, s);
        float R = uRadius * stem * roundTip(s * uLength, 0.5) * roundTip((1.0 - s) * uLength, uRadius * 1.1)
          * (1.0 - uBelly * pow(2.0 * s - 1.0, 2.0));
        return vec3(s, length(v) / max(R, 1e-3), atan(v.y, v.x));
      }
    `,
    skin: {
      bump: 1,
      material: { roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.5 },
      body: /* glsl */ `
        float facetEdge(vec3 c) {
          return smoothstep(0.85, 1.0, abs(sin((c.z - uFacetRotation) * uFacets * 0.5 + PI * 0.5)));
        }
        vec3 surfaceColor(vec3 p) {
          vec3 c = bananaCoords(p);
          vec3 col = mix(vec3(0.97, 0.82, 0.18), vec3(1.0, 0.88, 0.3), fbm(p * 0.5));
          col = mix(col, vec3(0.55, 0.65, 0.15), smoothstep(0.25, 0.05, c.x) * 0.7);
          col = mix(col, col * 0.8, facetEdge(c) * 0.5);
          // Sugar spots.
          float spot = smoothstep(0.18, 0.06, worley(p * vec3(0.9, 1.6, 1.6)));
          col = mix(col, vec3(0.45, 0.3, 0.1), spot * 0.8);
          // Dark ends: stem stub and blossom tip.
          return mix(col, vec3(0.25, 0.18, 0.08), smoothstep(0.035, 0.01, min(c.x, 1.0 - c.x)));
        }
        float surfaceHeight(vec3 p) {
          return -0.02 * facetEdge(bananaCoords(p)) + 0.006 * vnoise(p * 5.0);
        }
      `,
    },
    flesh: {
      bump: 1,
      material: { roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.4 },
      body: /* glsl */ `
        vec3 surfaceColor(vec3 p) {
          vec3 c = bananaCoords(p);
          vec3 col = vec3(0.98, 0.94, 0.78) * (0.96 + 0.06 * vnoise(p * 8.0));
          // Three-part seed core.
          float rays = smoothstep(0.9, 1.0, cos(3.0 * c.z)) * smoothstep(0.35, 0.05, c.y);
          col = mix(col, vec3(0.86, 0.8, 0.6), max(rays * 0.8, smoothstep(0.12, 0.04, c.y) * 0.6));
          float dots = smoothstep(0.1, 0.04, worley(p * 6.0)) * smoothstep(0.3, 0.1, c.y);
          col = mix(col, vec3(0.35, 0.25, 0.15), dots * 0.7);
          // Peel: whitish inner layer, yellow outside.
          col = mix(col, vec3(0.96, 0.94, 0.85), smoothstep(0.82, 0.86, c.y));
          return mix(col, vec3(0.95, 0.8, 0.2), smoothstep(0.93, 0.97, c.y));
        }
        float surfaceHeight(vec3 p) {
          vec3 c = bananaCoords(p);
          return 0.03 * smoothstep(0.84, 0.82, c.y) * smoothstep(0.7, 0.8, c.y) + 0.006 * vnoise(p * 9.0);
        }
      `,
    },
  };
}

/* ---------------------------------------------------------------- carrot */

function carrot(object: Extract<AnyGeneratedObject, { kind: "carrot" }>): KindShader {
  const p = object.params;
  return {
    splash: "#f78a24",
    uniforms: {
      uLength: p.length,
      uRadius: p.radius,
      uBend: p.bend,
      uTaper: p.taper,
      uCore: p.core,
    },
    declarations: /* glsl */ `
      uniform float uLength, uRadius, uBend, uTaper, uCore;
      vec3 carrotCoords(vec3 p) {
        float s = clamp((p.x + uLength * 0.5) / uLength, 0.0, 1.0);
        vec2 v = vec2(p.z - 4.0 * uBend * s * (1.0 - s), p.y);
        float R = uRadius * roundTip(s * uLength, uRadius * 0.5) * pow(1.0 - s, uTaper);
        return vec3(s, length(v) / max(R, 1e-3), atan(v.y, v.x));
      }
    `,
    skin: {
      bump: 1,
      material: { roughness: 0.6, clearcoat: 0.2, clearcoatRoughness: 0.5 },
      body: /* glsl */ `
        float ringLines(vec3 p) {
          return smoothstep(0.75, 0.95, vnoise(vec3(p.x * 3.0, 0.0, 0.0)) * (0.6 + 0.4 * vnoise(p * 2.0)));
        }
        vec3 surfaceColor(vec3 p) {
          vec3 c = carrotCoords(p);
          vec3 col = mix(vec3(0.93, 0.45, 0.08), vec3(0.98, 0.56, 0.12), fbm(p * 0.8));
          col = mix(col, vec3(0.7, 0.3, 0.05), ringLines(p) * 0.7);
          col = mix(col, vec3(0.45, 0.5, 0.12), smoothstep(0.04, 0.0, c.x));
          return col;
        }
        float surfaceHeight(vec3 p) { return -0.04 * ringLines(p) + 0.01 * vnoise(p * 6.0); }
      `,
    },
    flesh: {
      bump: 1,
      material: { roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3 },
      body: /* glsl */ `
        vec3 surfaceColor(vec3 p) {
          vec3 c = carrotCoords(p);
          vec3 col = vec3(0.98, 0.5, 0.1) * (0.95 + 0.08 * vnoise(p * 9.0));
          float core = smoothstep(uCore + 0.03, uCore - 0.03, c.y);
          col = mix(col, vec3(1.0, 0.68, 0.25), core);
          // Radial rays inside the core and a darker ring around it.
          float rays = smoothstep(0.92, 1.0, cos(c.z * 12.0)) * core * smoothstep(0.05, 0.2, c.y);
          col = mix(col, vec3(1.0, 0.8, 0.45), rays * 0.6);
          col = mix(col, vec3(0.9, 0.42, 0.06), smoothstep(0.04, 0.0, abs(c.y - uCore)) * 0.8);
          return mix(col, vec3(0.85, 0.38, 0.05), smoothstep(0.94, 0.99, c.y));
        }
        float surfaceHeight(vec3 p) {
          vec3 c = carrotCoords(p);
          return 0.02 * smoothstep(uCore, uCore - 0.1, c.y) + 0.006 * vnoise(p * 10.0);
        }
      `,
    },
  };
}

/* ---------------------------------------------------------------- cake */

const SPONGE = { vanilla: "#f2cf86", chocolate: "#5b3220", redVelvet: "#a01f2c" } as const;
const FROSTING = { white: "#fbf6ee", pink: "#f7b6cf", chocolate: "#6b3a22" } as const;

function cake(object: Extract<AnyGeneratedObject, { kind: "cake" }>): KindShader {
  const p = object.params;
  return {
    splash: FROSTING[p.frosting],
    uniforms: {
      uRadius: p.radius,
      uHeightTop: p.heightTop,
      uHeightBottom: p.heightBottom,
      uExponent: p.exponent,
      uOval: new THREE.Vector2(p.oval.amount, p.oval.angle),
      uSlump: new THREE.Vector2(p.slump.x, p.slump.z),
      uLayers: p.layers,
      uSponge: srgb(SPONGE[p.flavor]),
      uFrosting: srgb(FROSTING[p.frosting]),
      uSprinkles: p.sprinkles ? 1 : 0,
    },
    declarations: /* glsl */ `
      uniform float uRadius, uHeightTop, uHeightBottom, uExponent, uLayers, uSprinkles;
      uniform vec2 uOval, uSlump;
      uniform vec3 uSponge, uFrosting;
      vec3 unslump(vec3 p) { return vec3(p.x - p.y * uSlump.x, p.y, p.z - p.y * uSlump.y); }
      float cakeRatio(vec3 p) {
        float R = uRadius * (1.0 + uOval.x * cos(2.0 * (atan(p.z, p.x) - uOval.y)));
        float b = p.y > 0.0 ? uHeightTop : uHeightBottom;
        return pow(pow(length(p.xz) / R, uExponent) + pow(abs(p.y) / b, uExponent), 1.0 / uExponent);
      }
    `,
    skin: {
      bump: 1,
      material: { roughness: 0.35, clearcoat: 0.3, clearcoatRoughness: 0.4, sheen: 0.4, sheenColor: new THREE.Color("#ffffff") },
      body: /* glsl */ `
        // Colorful sprinkles on top: one capsule-ish dot per cell, color from the cell id.
        vec4 sprinkle(vec3 p) {
          vec2 w = worleyId(p * vec3(2.2, 0.5, 2.2));
          float on = uSprinkles * smoothstep(0.75, 0.9, p.y / uHeightTop) * smoothstep(0.2, 0.1, w.x) * step(0.35, w.y);
          vec3 c = w.y < 0.5 ? vec3(1.0, 0.3, 0.5) : w.y < 0.65 ? vec3(0.3, 0.75, 1.0) : w.y < 0.8 ? vec3(1.0, 0.85, 0.2) : vec3(0.4, 0.9, 0.4);
          return vec4(c, on);
        }
        // Spatula strokes: vertical swipes on the sides, soft ripples on top.
        // (Angle-based stripes on top would all converge on the center.)
        float strokes(vec3 p) {
          float side = smoothstep(0.65, 0.9, length(p.xz) / uRadius);
          float sideStrokes = sin(atan(p.z, p.x) * 18.0 + p.y * 1.5 + 4.0 * fbm(p * 0.6));
          float topRipples = fbm(p * vec3(0.8, 0.2, 0.8)) * 2.0 - 1.0;
          return mix(topRipples, sideStrokes, side);
        }
        vec3 surfaceColor(vec3 p) {
          p = unslump(p);
          vec3 col = uFrosting * (0.94 + 0.06 * strokes(p));
          vec4 s = sprinkle(p);
          return mix(col, s.rgb, s.a);
        }
        float surfaceHeight(vec3 p) {
          p = unslump(p);
          return 0.03 * strokes(p) + 0.05 * sprinkle(p).a;
        }
      `,
    },
    flesh: {
      bump: 1,
      material: { roughness: 0.85, sheen: 0.3, sheenColor: new THREE.Color("#fff6e8") },
      body: /* glsl */ `
        // 0 = sponge, 1 = cream (filling between layers and the outer coat).
        float cream(vec3 p) {
          float size = min(uRadius, uHeightTop);
          float coat = smoothstep(1.0 - 0.55 / size, 1.0 - 0.4 / size, cakeRatio(p));
          // Filling sits on the boundaries between sponge layers, about 4 mm thick.
          float innerHeight = uHeightTop + uHeightBottom - 0.5;
          float t = (p.y + uHeightBottom) / innerHeight * uLayers;
          float toBoundary = abs(t - floor(t + 0.5)) / uLayers * innerHeight;
          float interior = step(0.5, t) * step(t, uLayers - 0.5);
          float filling = interior * smoothstep(0.25, 0.18, toBoundary);
          return max(coat, filling);
        }
        float pores(vec3 p) { return smoothstep(0.28, 0.12, worley(p * 2.4)); }
        vec3 surfaceColor(vec3 p) {
          p = unslump(p);
          vec3 sponge = uSponge * (0.9 + 0.15 * vnoise(p * 10.0));
          sponge = mix(sponge, sponge * 0.75, pores(p));
          return mix(sponge, uFrosting, cream(p));
        }
        float surfaceHeight(vec3 p) {
          p = unslump(p);
          return mix(-0.06 * pores(p), 0.02, cream(p));
        }
        float surfaceRoughness(vec3 p, float base) { return mix(base, 0.4, cream(unslump(p))); }
      `,
    },
  };
}

export function kindShader(object: AnyGeneratedObject, skinColor: string): KindShader {
  switch (object.kind) {
    case "apple":
      return apple(object, skinColor);
    case "cucumber":
      return cucumber(object);
    case "bread":
      return bread(object);
    case "orange":
      return orange(object);
    case "tomato":
      return tomato(object);
    case "banana":
      return banana(object);
    case "carrot":
      return carrot(object);
    case "cake":
      return cake(object);
  }
}
