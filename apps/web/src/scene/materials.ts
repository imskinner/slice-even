import * as THREE from "three";
import type { AnyGeneratedObject } from "@slice-even/core";
import { BUMP_GLSL, NOISE_GLSL, type ShaderPart } from "./shaders/common.ts";
import { kindShader } from "./shaders/produce.ts";

export interface ObjectMaterials {
  skin: THREE.MeshPhysicalMaterial;
  /** Cut faces. */
  flesh: THREE.MeshPhysicalMaterial;
  /** Juice / crumb color for the cut splash. */
  splash: string;
}

type Uniforms = Record<string, THREE.IUniform>;

const DEFAULT_ROUGHNESS = "float surfaceRoughness(vec3 p, float base) { return base; }";

/**
 * MeshPhysicalMaterial whose albedo, bump and roughness come from GLSL
 * functions of the local position. Values go in as uniforms, so one compiled
 * program per kind and part is shared by every generated object.
 */
export function proceduralMaterial(
  cacheKey: string,
  uniforms: Uniforms,
  declarations: string,
  part: ShaderPart,
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial(part.material);
  const body = part.body.includes("surfaceRoughness") ? part.body : `${part.body}\n${DEFAULT_ROUGHNESS}`;
  const allUniforms: Uniforms = { ...uniforms, uBump: { value: part.bump } };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, allUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLocal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocal = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vLocal;\nuniform float uBump;\n${NOISE_GLSL}\n${BUMP_GLSL}\n${declarations}\n${body}`,
      )
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        "vec4 diffuseColor = vec4( toLinear( surfaceColor( vLocal ) ), opacity );",
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = clamp( surfaceRoughness( vLocal, roughnessFactor ), 0.04, 1.0 );",
      )
      .replace(
        "#include <normal_fragment_maps>",
        "#include <normal_fragment_maps>\nnormal = bumpNormal( normal, surfaceHeight( vLocal ), uBump );",
      );
  };
  // onBeforeCompile's source is the same for every kind, so key programs explicitly.
  material.customProgramCacheKey = () => cacheKey;
  return material;
}

export function createMaterials(object: AnyGeneratedObject, skinColor: string): ObjectMaterials {
  const shader = kindShader(object, skinColor);
  const uniforms: Uniforms = Object.fromEntries(Object.entries(shader.uniforms).map(([k, value]) => [k, { value }]));
  return {
    skin: proceduralMaterial(`${object.kind}:skin`, uniforms, shader.declarations, shader.skin),
    flesh: proceduralMaterial(`${object.kind}:flesh`, uniforms, shader.declarations, shader.flesh),
    splash: shader.splash,
  };
}

/** End-grain-free cutting board: long grain along X, a few knife scratches. */
export function woodMaterial(): THREE.MeshPhysicalMaterial {
  return proceduralMaterial(
    "board",
    {},
    "",
    {
      bump: 1,
      material: { roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.6 },
      body: /* glsl */ `
        float grain(vec3 p) {
          // Long fibers along X: tight stripes across Z, gently warped.
          float warp = fbm(p * vec3(0.04, 0.3, 0.3)) * 2.5;
          float stripes = 0.5 + 0.5 * sin((p.z + warp) * 9.0 + fbm(p * vec3(0.03, 1.5, 1.5)) * 3.0);
          float fine = vnoise(p * vec3(0.15, 6.0, 12.0));
          return mix(stripes, fine, 0.35);
        }
        float scratches(vec3 p) {
          float s = 0.0;
          for (int i = 0; i < 3; i++) {
            float a = hash13(vec3(float(i), 1.0, 2.0)) * 3.14159;
            vec2 d = vec2(cos(a), sin(a));
            float line = abs(dot(p.xz, vec2(-d.y, d.x)) + hash13(vec3(float(i), 4.0, 5.0)) * 10.0 - 5.0);
            s = max(s, smoothstep(0.04, 0.0, line) * smoothstep(9.0, 3.0, abs(dot(p.xz, d))));
          }
          return s;
        }
        vec3 surfaceColor(vec3 p) {
          vec3 light = vec3(0.78, 0.55, 0.32);
          vec3 dark = vec3(0.55, 0.34, 0.17);
          vec3 col = mix(dark, light, smoothstep(0.25, 0.75, grain(p)));
          // Broad tone variation between planks of the glued board.
          col *= 0.85 + 0.25 * vnoise(vec3(0.0, 0.0, floor(p.z / 4.0) * 3.1));
          col *= 0.92 + 0.12 * vnoise(p * vec3(0.3, 4.0, 4.0));
          return mix(col, vec3(0.92, 0.78, 0.6), scratches(p) * 0.5);
        }
        float surfaceHeight(vec3 p) {
          return 0.02 * grain(p) - 0.03 * scratches(p);
        }
      `,
    },
  );
}
