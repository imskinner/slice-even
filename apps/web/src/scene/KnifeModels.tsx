import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { KnifeSkin } from "../progress/skins.ts";

/**
 * The knives. Each skin is its own object, not a recolor: a different blade
 * outline, finish and handle. They share one frame of reference: the cutting
 * edge lies along Z at y = 0 (z from -8 at the heel to +8 at the tip), the
 * blade is thin along X (the cut's normal), and the handle goes off the far
 * end (-Z), where it does not hide the object from the default camera.
 */

const LENGTH = 16;
const HEEL = -LENGTH / 2;
const TIP = LENGTH / 2;

/* ------------------------------------------------------------------ steel */

interface Finish {
  color: string;
  roughness: number;
  /** Height of the grind line: below it the blade is beveled down to the edge. */
  grind: number;
  /** Above this height the steel keeps its black forge scale (99 = polished all over). */
  forge?: number;
  /** Hammer marks in the forge-black part, 0..1. */
  hammer?: number;
  /** Damascus: wavy layers etched into the flat of the blade, 0..1. */
  waves?: number;
}

/**
 * Polished steel that reads as steel: fully metallic and lit by the room's
 * reflections (turned up, since the scene keeps its environment dim), with a
 * grind line where the bevel starts, fine brushing along the blade, and
 * optionally forge scale, hammer marks or damascus layers. All of that is
 * done in the shader from the blade's own coordinates, so every outline gets
 * it for free.
 */
export function bladeMaterial(finish: Finish): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: finish.color,
    metalness: 1,
    roughness: finish.roughness,
    envMapIntensity: 2.6,
  });
  const uniforms = {
    uGrind: { value: finish.grind },
    uForge: { value: finish.forge ?? 99 },
    uHammer: { value: finish.hammer ?? 0 },
    uWaves: { value: finish.waves ?? 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBlade;\nvarying vec3 vDown;\nvarying vec3 vAlong;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vBlade = position;
        vDown = normalize(normalMatrix * vec3(0.0, -1.0, 0.0));
        vAlong = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        varying vec3 vBlade;
        varying vec3 vDown;
        varying vec3 vAlong;
        uniform float uGrind, uForge, uHammer, uWaves;
        float bladeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float bladeNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(bladeHash(i), bladeHash(i + vec2(1.0, 0.0)), f.x), mix(bladeHash(i + vec2(0.0, 1.0)), bladeHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        // 1 on the bevel that runs down to the edge.
        float bladeBevel() { return 1.0 - smoothstep(uGrind - 0.04, uGrind + 0.04, vBlade.y); }
        // 1 where the forge scale was left on, with a ragged border.
        float bladeForge() { return smoothstep(uForge - 0.1, uForge + 0.1, vBlade.y + 0.3 * (bladeNoise(vec2(vBlade.z * 1.4, 3.0)) - 0.5)); }
        // Layers of damascus, on the flat only.
        float bladeWaves() {
          float layers = sin(vBlade.y * 10.0 + 2.6 * sin(vBlade.z * 1.2) + 5.0 * bladeNoise(vBlade.zy * 0.7));
          return uWaves * (0.5 + 0.5 * layers) * (1.0 - bladeBevel()) * (1.0 - bladeForge());
        }`,
      )
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        `vec4 diffuseColor = vec4( diffuse, opacity );
        diffuseColor.rgb *= 1.0 - 0.28 * bladeWaves();
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.035, 0.04), bladeForge());`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        // Brushing: fine lines along the length. The bevel is honed brighter.
        roughnessFactor += 0.12 * (bladeNoise(vec2(vBlade.z * 0.5, vBlade.y * 60.0)) - 0.5);
        roughnessFactor -= 0.07 * bladeBevel();
        roughnessFactor += 0.22 * bladeWaves();
        roughnessFactor = clamp(mix(roughnessFactor, 0.78, bladeForge()), 0.03, 1.0);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        // The bevel leans towards the edge, so it catches the light differently from the flat.
        normal = normalize(normal + 0.5 * bladeBevel() * vDown);
        // Hammer marks: shallow dents, each tilting the surface its own way.
        vec2 dent = vec2(bladeNoise(vBlade.zy * 2.4), bladeNoise(vBlade.zy * 2.4 + 9.7)) - 0.5;
        normal = normalize(normal + uHammer * bladeForge() * 1.6 * (dent.x * vAlong + dent.y * vDown));`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // A photographer's light tent: the room this scene reflects is dim, and
        // a mirror in a dim room is just dark. So the blade also reflects a
        // bright sky above and one long soft-box, which slide across it as it turns.
        vec3 bladeSees = inverseTransformDirection(reflect(-normalize(vViewPosition), normal), viewMatrix);
        float tentSky = smoothstep(-0.95, 0.6, bladeSees.y);
        float tentBox = smoothstep(0.78, 1.0, 0.5 + 0.5 * sin(bladeSees.x * 3.1 + bladeSees.z * 2.3 + 0.6));
        float polish = (1.0 - bladeForge()) * (1.0 - 0.5 * bladeWaves());
        totalEmissiveRadiance += diffuse * polish * (0.12 + 0.55 * tentSky + 0.4 * tentBox);`,
      );
  };
  // One program for every finish: only uniform values differ.
  material.customProgramCacheKey = () => "blade";
  return material;
}

type Outline = "chef" | "german" | "nakiri" | "cleaver" | "saber" | "tanto";

/** The blade seen from the side, edge along the bottom, extruded thin. */
function bladeGeometry(outline: Outline, h: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(HEEL, 0);
  switch (outline) {
    case "chef":
      // Straight edge, belly sweeping up to a point, straight spine.
      s.lineTo(TIP - 4, 0);
      s.quadraticCurveTo(TIP - 0.6, 0.15, TIP, h * 0.62);
      s.quadraticCurveTo(TIP - 1.2, h, TIP - 4.5, h);
      break;
    case "german":
      // A tall blade with a long rocking belly and a spine that drops to the tip.
      s.lineTo(TIP - 7, 0);
      s.quadraticCurveTo(TIP - 1.5, 0.2, TIP, h * 0.78);
      s.quadraticCurveTo(TIP - 2.5, h * 0.98, TIP - 7, h);
      break;
    case "nakiri":
      // A vegetable knife: flat edge, square nose with the corners eased.
      s.lineTo(TIP - 0.5, 0);
      s.quadraticCurveTo(TIP, 0, TIP, 0.5);
      s.lineTo(TIP, h - 0.9);
      s.quadraticCurveTo(TIP, h, TIP - 0.9, h);
      break;
    case "cleaver":
      // A slab: gently curved edge, square nose.
      s.quadraticCurveTo(0, -0.12, TIP, 0.1);
      s.lineTo(TIP, h);
      break;
    case "saber":
      // A trailing point: the edge sweeps up past the spine, which dips towards it.
      s.lineTo(TIP - 8, 0);
      s.quadraticCurveTo(TIP - 1.5, 0.1, TIP + 0.9, h * 1.2);
      s.quadraticCurveTo(TIP - 2.6, h * 0.82, TIP - 7, h * 0.94);
      break;
    case "tanto":
      // Angular: a second, short edge up to the point.
      s.lineTo(TIP - 2.2, 0);
      s.lineTo(TIP, h * 0.58);
      s.lineTo(TIP - 2.8, h);
      break;
  }
  s.lineTo(HEEL, h);
  s.closePath();
  if (outline === "cleaver") {
    // The hole it hangs from.
    const hole = new THREE.Path();
    hole.absarc(TIP - 1.5, h - 1.15, 0.5, 0, Math.PI * 2, true);
    s.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(s, {
    depth: outline === "cleaver" ? 0.16 : 0.1,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.05,
    bevelSegments: 1,
    curveSegments: 18,
  });
  // Drawn in XY and extruded along Z: stand it along Z, thin along X.
  geometry.translate(0, 0, outline === "cleaver" ? -0.08 : -0.05);
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}

function useDisposable<T extends { dispose(): void }>(make: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(make, deps);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

function Blade({ outline, height, finish }: { outline: Outline; height: number; finish: Finish }) {
  const geometry = useDisposable(() => bladeGeometry(outline, height), [outline, height]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const material = useDisposable(() => bladeMaterial(finish), [JSON.stringify(finish)]);
  return <mesh geometry={geometry} material={material} castShadow />;
}

/* ------------------------------------------------------------------ parts */

const STEEL = { color: "#d9dee2", metalness: 1, roughness: 0.22, envMapIntensity: 2.4 } as const;
const BRASS = { color: "#d8a94a", metalness: 1, roughness: 0.25, envMapIntensity: 2.4 } as const;

/** The collar between blade and handle. */
function Bolster({ y, height, color = STEEL.color }: { y: number; height: number; color?: string }) {
  return (
    <mesh position={[0, y, HEEL - 0.35]} castShadow>
      <boxGeometry args={[0.62, height, 0.8]} />
      <meshStandardMaterial {...STEEL} color={color} />
    </mesh>
  );
}

/** A western handle: two scales riveted to the tang, with a steel cap. */
function RivetedHandle({ y, color, rivets = 3, cap = true }: { y: number; color: string; rivets?: number; cap?: boolean }) {
  const length = 7.2;
  const z = HEEL - 0.75 - length / 2;
  return (
    <group position={[0, y, z]}>
      <RoundedBox args={[0.95, 1.5, length]} radius={0.38} smoothness={3} castShadow>
        <meshStandardMaterial color={color} roughness={0.5} />
      </RoundedBox>
      {Array.from({ length: rivets }, (_, i) => (
        <mesh key={i} position={[0, 0, (i - (rivets - 1) / 2) * 2.1]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.16, 0.16, 1.0, 12]} />
          <meshStandardMaterial {...BRASS} />
        </mesh>
      ))}
      {cap && (
        <mesh position={[0, 0, -length / 2 - 0.1]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.62, 0.7, 0.45, 16]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
      )}
    </group>
  );
}

/** A Japanese handle: an octagonal stick of pale wood with a dark horn collar. */
function OctagonHandle({ y }: { y: number }) {
  const length = 7.6;
  return (
    <group position={[0, y, HEEL - 0.3 - length / 2]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh castShadow rotation={[0, Math.PI / 8, 0]}>
        <cylinderGeometry args={[0.66, 0.6, length, 8]} />
        <meshStandardMaterial color="#d9b98a" roughness={0.7} />
      </mesh>
      <mesh position={[0, length / 2 - 0.55, 0]} rotation={[0, Math.PI / 8, 0]} castShadow>
        <cylinderGeometry args={[0.7, 0.7, 1.2, 8]} />
        <meshStandardMaterial color="#1c1612" roughness={0.35} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ the knives */

function Classic({ h }: { h: number }) {
  return (
    <>
      <Blade outline="chef" height={h} finish={{ color: "#dfe5ea", roughness: 0.24, grind: h * 0.42 }} />
      <Bolster y={h * 0.6} height={Math.min(2.1, h * 0.72)} />
      <RivetedHandle y={h * 0.6} color="#17191c" />
    </>
  );
}

function Chef({ h }: { h: number }) {
  return (
    <>
      {/* Mirror polish with damascus layers. */}
      <Blade outline="german" height={h} finish={{ color: "#eef2f5", roughness: 0.1, grind: h * 0.3, waves: 1 }} />
      <Bolster y={h * 0.62} height={Math.min(2.6, h * 0.7)} />
      {/* A red liner between the bolster and the pakkawood. */}
      <mesh position={[0, h * 0.62, HEEL - 0.85]}>
        <boxGeometry args={[0.98, 1.54, 0.18]} />
        <meshStandardMaterial color="#c8102e" roughness={0.4} />
      </mesh>
      <RivetedHandle y={h * 0.62} color="#3a1d12" rivets={2} />
    </>
  );
}

function Rustic({ h }: { h: number }) {
  return (
    <>
      {/* Kurouchi: forge-black and hammered above, polished only where it cuts. */}
      <Blade outline="nakiri" height={h} finish={{ color: "#cfd3d6", roughness: 0.3, grind: h * 0.3, forge: h * 0.5, hammer: 1 }} />
      <OctagonHandle y={h - 0.8} />
    </>
  );
}

function Cleaver({ h }: { h: number }) {
  return (
    <>
      <Blade outline="cleaver" height={h} finish={{ color: "#c3cace", roughness: 0.3, grind: h * 0.16 }} />
      <group position={[0, h - 1.1, HEEL - 3.9]}>
        <RoundedBox args={[1.2, 1.8, 7.4]} radius={0.5} smoothness={3} castShadow>
          <meshStandardMaterial color="#5a3620" roughness={0.6} />
        </RoundedBox>
        {[-2.4, 2.4].map((z) => (
          <mesh key={z} position={[0, 0, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.2, 0.2, 1.26, 12]} />
            <meshStandardMaterial {...STEEL} />
          </mesh>
        ))}
        {/* A ring to hang it by. */}
        <mesh position={[0, 0, -4.2]} rotation={[0, Math.PI / 2, 0]} castShadow>
          <torusGeometry args={[0.55, 0.11, 10, 24]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
      </group>
    </>
  );
}

const GOLD = { color: "#f6c644", metalness: 1, roughness: 0.14, envMapIntensity: 2.8 } as const;

function Golden({ h }: { h: number }) {
  const y = h * 0.55;
  return (
    <>
      <Blade outline="saber" height={h} finish={{ color: "#ffcf4d", roughness: 0.1, grind: h * 0.36, waves: 0.5 }} />
      {/* A cross-guard, a wrapped grip between gold rings, and a jewel in the pommel. */}
      <mesh position={[0, y, HEEL - 0.3]} castShadow>
        <boxGeometry args={[0.7, h * 1.15, 0.6]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      <group position={[0, y, HEEL - 3.7]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.52, 0.46, 6, 16]} />
          <meshStandardMaterial color="#7d1220" roughness={0.75} />
        </mesh>
        {[-2, 0, 2].map((at) => (
          <mesh key={at} position={[0, at, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.52, 0.08, 8, 20]} />
            <meshStandardMaterial {...GOLD} />
          </mesh>
        ))}
        <mesh position={[0, -3.3, 0]} castShadow>
          <sphereGeometry args={[0.68, 20, 14]} />
          <meshStandardMaterial {...GOLD} />
        </mesh>
        <mesh position={[0, -3.95, 0]}>
          <icosahedronGeometry args={[0.36, 0]} />
          <meshStandardMaterial color="#e0113a" metalness={0.3} roughness={0.08} emissive="#7a0018" envMapIntensity={3} flatShading />
        </mesh>
      </group>
    </>
  );
}

/** Light that is its own color whatever the room's lighting says. */
function glow(color: string, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial(
    opacity === 1
      ? { color, toneMapped: false }
      : { color, toneMapped: false, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false },
  );
}

/** Materials of the glowing knives, for the canvas to compile ahead of time. */
export function glowMaterials(): THREE.Material[] {
  return [glow("#ffffff"), glow("#ffffff", 0.5)];
}

function Neon({ h }: { h: number }) {
  // The outline of the blade as a tube of light around dark glass, with a wider, fainter one for the haze.
  const tubes = useMemo(() => {
    const corners: [number, number][] = [
      [HEEL, 0],
      [TIP - 2.2, 0],
      [TIP, h * 0.58],
      [TIP - 2.8, h],
      [HEEL, h],
    ];
    const path = new THREE.CurvePath<THREE.Vector3>();
    corners.forEach(([z, y], i) => {
      const [nz, ny] = corners[(i + 1) % corners.length]!;
      path.add(new THREE.LineCurve3(new THREE.Vector3(0, y, z), new THREE.Vector3(0, ny, nz)));
    });
    return { line: new THREE.TubeGeometry(path, 120, 0.075, 8, true), haze: new THREE.TubeGeometry(path, 120, 0.24, 8, true) };
  }, [h]);
  useEffect(
    () => () => {
      tubes.line.dispose();
      tubes.haze.dispose();
    },
    [tubes],
  );
  const line = useDisposable(() => glow("#7ff6ff"), []);
  const haze = useDisposable(() => glow("#19d3ee", 0.32), []);
  const pink = useDisposable(() => glow("#ff3ea5"), []);
  useFrame(({ clock }) => {
    // A tube that hums.
    haze.opacity = 0.26 + 0.1 * Math.sin(clock.elapsedTime * 9);
  });
  const y = h * 0.6;
  return (
    <>
      <Blade outline="tanto" height={h} finish={{ color: "#141a2e", roughness: 0.16, grind: h * 0.34 }} />
      <mesh geometry={tubes.line} material={line} />
      <mesh geometry={tubes.haze} material={haze} />
      <group position={[0, y, HEEL - 3.9]}>
        <RoundedBox args={[0.9, 1.4, 7]} radius={0.35} smoothness={3} castShadow>
          <meshStandardMaterial color="#11131f" roughness={0.35} metalness={0.4} />
        </RoundedBox>
        {[-2.2, 0, 2.2].map((z) => (
          <mesh key={z} position={[0, 0, z]} material={pink}>
            <boxGeometry args={[0.96, 1.46, 0.16]} />
          </mesh>
        ))}
      </group>
    </>
  );
}

const SABER_COLOR = "#ff2b3d";
/** Radius of the blade of light; it rests on the cut line. */
const BEAM = 0.2;

/**
 * The laser knife: a hilt and a blade of light, held flat so its underside
 * is the cutting edge. A white-hot core inside layers of colored glow; the
 * glow breathes, the way these things do.
 */
function Lightsaber() {
  const core = useDisposable(() => glow("#fff4f4"), []);
  const inner = useDisposable(() => glow(SABER_COLOR, 0.6), []);
  const outer = useDisposable(() => glow(SABER_COLOR, 0.22), []);
  const beam = useDisposable(() => new THREE.CapsuleGeometry(BEAM, LENGTH - 2 * BEAM, 8, 16), []);
  const shells = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const flicker = 1 + 0.05 * Math.sin(t * 37) + 0.03 * Math.sin(t * 91);
    shells.current.scale.set(flicker, 1, flicker);
    outer.opacity = 0.2 + 0.05 * Math.sin(t * 23);
  });
  return (
    <group position={[0, BEAM, 0]}>
      {/* Capsules stand along Y: lay them along the blade. */}
      <group rotation={[Math.PI / 2, 0, 0]}>
        <mesh geometry={beam} material={core} />
        <group ref={shells}>
          <mesh geometry={beam} material={inner} scale={[2.1, 1.01, 2.1]} />
          <mesh geometry={beam} material={outer} scale={[4.2, 1.03, 4.2]} />
        </group>
      </group>
      {/* The hilt: emitter, ribbed grip, pommel, and the button. */}
      <group position={[0, 0, HEEL]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh position={[0, -0.35, 0]} castShadow>
          <cylinderGeometry args={[0.52, 0.34, 0.7, 20]} />
          <meshStandardMaterial {...STEEL} roughness={0.18} />
        </mesh>
        <mesh position={[0, -3.3, 0]} castShadow>
          <cylinderGeometry args={[0.42, 0.42, 5.2, 20]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        {[-2.2, -2.9, -3.6, -4.3, -5.0].map((at) => (
          <mesh key={at} position={[0, at, 0]} castShadow>
            <cylinderGeometry args={[0.5, 0.5, 0.36, 20]} />
            <meshStandardMaterial color="#15171a" roughness={0.6} />
          </mesh>
        ))}
        <mesh position={[0, -6.15, 0]} castShadow>
          <cylinderGeometry args={[0.56, 0.48, 0.5, 20]} />
          <meshStandardMaterial {...STEEL} roughness={0.18} />
        </mesh>
        <mesh position={[0.46, -1.35, 0]} material={core}>
          <boxGeometry args={[0.16, 0.36, 0.3]} />
        </mesh>
      </group>
    </group>
  );
}

/** The chosen knife, in the shared frame: edge along Z at y = 0. */
export function KnifeModel({ skin, height }: { skin: KnifeSkin; height: number }) {
  switch (skin.id) {
    case "chef":
      return <Chef h={height} />;
    case "rustic":
      return <Rustic h={height} />;
    case "cleaver":
      return <Cleaver h={height} />;
    case "golden":
      return <Golden h={height} />;
    case "neon":
      return <Neon h={height} />;
    case "laser":
      return <Lightsaber />;
    default:
      return <Classic h={height} />;
  }
}
