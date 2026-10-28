import * as THREE from "three";
import type { AnyGeneratedObject } from "@slice-even/core";
import * as G from "./glsl.ts";

export interface ObjectMaterials {
  skin: THREE.MeshStandardMaterial;
  /** Cut faces. */
  flesh: THREE.MeshStandardMaterial;
}

type Uniforms = Record<string, THREE.IUniform>;

/**
 * MeshStandardMaterial whose base color comes from `surfaceColor(localPos)`
 * defined in `body`. Values go in as uniforms, so one compiled program per
 * kind and part is shared by every generated object.
 */
function proceduralMaterial(
  cacheKey: string,
  uniforms: Uniforms,
  declarations: string,
  body: string,
  params: THREE.MeshStandardMaterialParameters,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial(params);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLocal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocal = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vLocal;\n${G.NOISE_GLSL}\n${declarations}\n${body}`,
      )
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        "vec4 diffuseColor = vec4( toLinear( surfaceColor( vLocal ) ), opacity );",
      );
  };
  // onBeforeCompile's source is the same for every kind, so key programs explicitly.
  material.customProgramCacheKey = () => cacheKey;
  return material;
}

const u = (value: unknown): THREE.IUniform => ({ value });

export function createMaterials(object: AnyGeneratedObject, skinColor: string): ObjectMaterials {
  switch (object.kind) {
    case "apple": {
      const { core, lean, heightRatio } = object.params;
      const uniforms: Uniforms = {
        uSkin: u(new THREE.Color(skinColor).convertLinearToSRGB()),
        // Lean is applied after the height squash in the generator.
        uLean: u(new THREE.Vector2(lean.x, lean.z)),
        uCoreRadius: u(core.radius),
        uCoreHeight: u(core.height * heightRatio),
        uCoreY: u(core.offsetY * heightRatio),
        uCoreRotation: u(core.rotation),
        uSeedDistance: u(core.seedDistance),
        uSeeds: u(core.seeds.map((s) => (s ? 1 : 0))),
      };
      return {
        skin: proceduralMaterial("apple:skin", uniforms, G.APPLE_UNIFORMS, G.APPLE_SKIN, { roughness: 0.4 }),
        flesh: proceduralMaterial("apple:flesh", uniforms, G.APPLE_UNIFORMS, G.APPLE_FLESH, { roughness: 0.75 }),
      };
    }
    case "cucumber": {
      const p = object.params;
      const uniforms: Uniforms = {
        uLength: u(p.length),
        uBend: u(p.bend),
        uRadius: u(p.radius),
        uCap: u(p.capLength),
        uTaper: u(p.taper),
        uSeedRotation: u(p.seedRotation),
      };
      return {
        skin: proceduralMaterial("cucumber:skin", uniforms, G.CUCUMBER_UNIFORMS, G.CUCUMBER_SKIN, {
          roughness: 0.5,
        }),
        flesh: proceduralMaterial("cucumber:flesh", uniforms, G.CUCUMBER_UNIFORMS, G.CUCUMBER_FLESH, {
          roughness: 0.6,
        }),
      };
    }
    case "bread": {
      const p = object.params;
      const uniforms: Uniforms = {
        uLengthPos: u(p.lengthPos),
        uLengthNeg: u(p.lengthNeg),
        uHeightTop: u(p.heightTop),
        uHeightBottom: u(p.heightBottom),
        uWidth: u(p.width),
        uExpTop: u(p.exponentTop),
        uExpBottom: u(p.exponentBottom),
        uExpFootprint: u(p.exponentFootprint),
        uSlope: u(p.slope),
      };
      return {
        skin: proceduralMaterial("bread:crust", uniforms, G.BREAD_UNIFORMS, G.BREAD_CRUST, { roughness: 0.85 }),
        flesh: proceduralMaterial("bread:crumb", uniforms, G.BREAD_UNIFORMS, G.BREAD_CRUMB, { roughness: 0.95 }),
      };
    }
  }
}
