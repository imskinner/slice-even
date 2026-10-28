import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { generateObject, type ObjectKind } from "@slice-even/core";
import { createMaterials, proceduralMaterial } from "./materials.ts";
import { toBufferGeometry } from "./geometry.ts";
import { appearanceFor } from "../game.ts";

/**
 * The kitchen around the cutting board: tiled wall, terrazzo counter and a
 * few props. All procedural, so nothing to download. The board's underside
 * is at y = -1.5, which is where the counter top sits.
 */

const COUNTER_TOP = -1.5;
const WALL_Z = -58;

function useDisposable<T extends { dispose(): void }>(make: () => T): T {
  const value = useMemo(make, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

function tileMaterial() {
  return proceduralMaterial("wall-tiles", {}, "", {
    bump: 1,
    material: { roughness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.15 },
    body: /* glsl */ `
      // Staggered 15 x 7.5 cm subway tiles. Returns distance to the grout (cm) and a per-tile id.
      vec2 tile(vec3 p) {
        vec2 uv = vec2(p.x / 15.0, (p.y + 100.0) / 7.5);
        float row = floor(uv.y);
        uv.x += mod(row, 2.0) * 0.5;
        vec2 cell = floor(uv);
        vec2 f = fract(uv);
        vec2 d = min(f, 1.0 - f) * vec2(15.0, 7.5);
        return vec2(min(d.x, d.y), hash13(vec3(cell, 3.0)));
      }
      vec3 surfaceColor(vec3 p) {
        vec2 t = tile(p);
        vec3 glaze = mix(vec3(0.1, 0.5, 0.53), vec3(0.16, 0.6, 0.6), t.y);
        // A few accent tiles.
        glaze = t.y > 0.94 ? vec3(0.95, 0.86, 0.62) : t.y > 0.9 ? vec3(0.3, 0.78, 0.68) : glaze;
        glaze *= 0.92 + 0.12 * vnoise(p * 0.4);
        return mix(vec3(0.86, 0.83, 0.75), glaze, smoothstep(0.2, 0.35, t.x));
      }
      float surfaceHeight(vec3 p) {
        // Rounded tile edges sitting proud of the grout.
        return 0.18 * smoothstep(0.15, 0.9, tile(p).x) + 0.004 * vnoise(p * 3.0);
      }
      float surfaceRoughness(vec3 p, float base) {
        return mix(0.9, base, smoothstep(0.2, 0.35, tile(p).x));
      }
    `,
  });
}

function terrazzoMaterial() {
  return proceduralMaterial("counter-terrazzo", {}, "", {
    bump: 1,
    material: { roughness: 0.32, clearcoat: 0.4, clearcoatRoughness: 0.25 },
    body: /* glsl */ `
      vec4 chip(vec3 p) {
        // Chips of ~3-6 mm; not every cell gets one.
        vec2 w = worleyId(p * 1.8);
        float on = smoothstep(0.2, 0.15, w.x) * step(0.35, fract(w.y * 7.31));
        vec3 c = w.y < 0.3 ? vec3(0.95, 0.45, 0.35)
               : w.y < 0.55 ? vec3(0.2, 0.55, 0.55)
               : w.y < 0.75 ? vec3(0.98, 0.8, 0.35)
               : vec3(0.35, 0.3, 0.28);
        return vec4(c, on);
      }
      vec3 surfaceColor(vec3 p) {
        vec3 base = vec3(0.94, 0.92, 0.87) * (0.95 + 0.06 * vnoise(p * 2.0));
        vec4 c = chip(p);
        float fine = smoothstep(0.1, 0.06, worley(p * 3.0)) * 0.3;
        return mix(mix(base, vec3(0.6, 0.58, 0.55), fine), c.rgb, c.a);
      }
      float surfaceHeight(vec3 p) { return -0.01 * chip(p).a; }
    `,
  });
}

function Wall() {
  const material = useDisposable(tileMaterial);
  return (
    <mesh position={[0, COUNTER_TOP + 70, WALL_Z - 1]} material={material} receiveShadow>
      <boxGeometry args={[320, 140, 2]} />
    </mesh>
  );
}

function Counter() {
  const material = useDisposable(terrazzoMaterial);
  return (
    // From the wall to well past the camera, so neither edge is ever in view.
    <mesh position={[0, COUNTER_TOP - 3, 16]} material={material} receiveShadow>
      <boxGeometry args={[320, 6, 150]} />
    </mesh>
  );
}

function Window() {
  const sky = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        // A bright morning sky with a hint of sun in the corner.
        fragmentShader: `varying vec2 vUv;
          void main() {
            vec3 top = vec3(0.55, 0.82, 1.0), low = vec3(1.0, 0.93, 0.78);
            vec3 c = mix(low, top, smoothstep(0.0, 1.0, vUv.y));
            c += vec3(1.0, 0.9, 0.6) * 0.6 * smoothstep(0.5, 0.0, distance(vUv, vec2(0.85, 0.8)));
            gl_FragColor = vec4(c, 1.0);
          }`,
        toneMapped: false,
      }),
  );
  const frame = <meshStandardMaterial color="#fffaf0" roughness={0.5} />;
  return (
    <group position={[-24, COUNTER_TOP + 28, WALL_Z + 0.2]}>
      <mesh material={sky}>
        <planeGeometry args={[36, 26]} />
      </mesh>
      {[
        [0, 13.8, 39, 1.6],
        [0, -13.8, 39, 1.6],
        [-18.8, 0, 1.6, 29],
        [18.8, 0, 1.6, 29],
        [0, 0, 1, 26],
        [0, 0, 36, 1],
      ].map(([x, y, w, h], i) => (
        <mesh key={i} position={[x!, y!, 0.6]} castShadow>
          <boxGeometry args={[w!, h!, 1.4]} />
          {frame}
        </mesh>
      ))}
      {/* Sill. */}
      <mesh position={[0, -15.4, 2]}>
        <boxGeometry args={[42, 1.2, 5]} />
        {frame}
      </mesh>
    </group>
  );
}

/** A coral bowl holding real generated produce. */
function FruitBowl({ position }: { position: THREE.Vector3Tuple }) {
  const bowlGeometry = useDisposable(() => {
    const profile: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      profile.push(new THREE.Vector2(2.5 + 8.5 * Math.sin((t * Math.PI) / 2), 5 * (1 - Math.cos((t * Math.PI) / 2))));
    }
    return new THREE.LatheGeometry(profile, 48);
  });
  const fruits = useMemo(() => {
    const picks: [ObjectKind, string, THREE.Vector3Tuple][] = [
      ["orange", "bowl-1", [-3, 6, 0.5]],
      ["apple", "bowl-2", [3.2, 6, -1]],
      ["tomato", "bowl-3", [0, 5.5, 3.5]],
      ["banana", "bowl-4", [0, 9.5, -1.5]],
    ];
    return picks.map(([kind, seed, at]) => {
      const object = generateObject(kind, seed, "preview");
      return { geometry: toBufferGeometry(object.mesh), materials: createMaterials(object, appearanceFor(seed).skinColor), at };
    });
  }, []);
  useEffect(
    () => () => {
      for (const f of fruits) {
        f.geometry.dispose();
        f.materials.skin.dispose();
        f.materials.flesh.dispose();
      }
    },
    [fruits],
  );
  return (
    <group position={position}>
      <mesh geometry={bowlGeometry} castShadow receiveShadow>
        <meshPhysicalMaterial color="#ff6b57" roughness={0.25} clearcoat={1} clearcoatRoughness={0.1} side={THREE.DoubleSide} />
      </mesh>
      {fruits.map((f, i) => (
        <mesh
          key={i}
          geometry={f.geometry}
          material={f.materials.skin}
          position={f.at}
          rotation={[0.3 * i, i * 1.7, i === 3 ? 0.4 : 0]}
          scale={i === 3 ? 0.75 : 1}
          castShadow
        />
      ))}
    </group>
  );
}

function Jars({ position }: { position: THREE.Vector3Tuple }) {
  const glass = useDisposable(
    () => new THREE.MeshPhysicalMaterial({ color: "#e8fbff", roughness: 0.05, transparent: true, opacity: 0.28, clearcoat: 1 }),
  );
  const jars: [number, number, number, string][] = [
    [0, 3.4, 13, "#ffd166"],
    [8, 3, 9, "#ef8354"],
    [15, 2.6, 16, "#8d5a3b"],
  ];
  return (
    <group position={position}>
      {jars.map(([x, r, h, fill], i) => (
        <group key={i} position={[x, 0, (i % 2) * 2]}>
          <mesh position={[0, (h * 0.7) / 2, 0]}>
            <cylinderGeometry args={[r * 0.9, r * 0.9, h * 0.7, 24]} />
            <meshStandardMaterial color={fill} roughness={0.9} />
          </mesh>
          <mesh position={[0, h / 2, 0]} material={glass}>
            <cylinderGeometry args={[r, r, h, 32]} />
          </mesh>
          <mesh position={[0, h + 0.8, 0]} castShadow>
            <cylinderGeometry args={[r * 1.05, r * 1.05, 1.6, 32]} />
            <meshStandardMaterial color="#b9844f" roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Plant({ position }: { position: THREE.Vector3Tuple }) {
  const leaves = useMemo(
    () =>
      Array.from({ length: 11 }, (_, i) => {
        const a = (i / 11) * Math.PI * 2 + i * 0.4;
        const up = 0.5 + (i % 3) * 0.25;
        return { a, up, len: 7 + (i % 4) * 1.6 };
      }),
    [],
  );
  return (
    <group position={position}>
      <mesh position={[0, 4.5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[5, 3.8, 9, 28]} />
        <meshStandardMaterial color="#d9714a" roughness={0.85} />
      </mesh>
      <mesh position={[0, 9.2, 0]} castShadow>
        <cylinderGeometry args={[5.4, 5.2, 1.2, 28]} />
        <meshStandardMaterial color="#c9643f" roughness={0.85} />
      </mesh>
      {leaves.map(({ a, up, len }, i) => (
        <group key={i} position={[0, 9.5, 0]} rotation={[0, a, 0]}>
          <mesh position={[len * 0.45, len * up * 0.6, 0]} rotation={[0, 0, Math.PI / 2 - up]} scale={[0.6, len / 2, 0.12]} castShadow>
            <sphereGeometry args={[1.6, 12, 8]} />
            <meshStandardMaterial color={i % 2 ? "#3f9b4a" : "#2f8040"} roughness={0.55} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function KnifeBlock({ position }: { position: THREE.Vector3Tuple }) {
  return (
    <group position={position} rotation={[0, 0.4, 0]}>
      <mesh position={[0, 6, 0]} rotation={[-0.25, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[9, 13, 7]} />
        <meshStandardMaterial color="#a9713f" roughness={0.65} />
      </mesh>
      {[-2.6, 0, 2.6].map((x, i) => (
        <mesh key={i} position={[x, 14 + i * 0.6, -1.8]} rotation={[-0.25, 0, 0]} castShadow>
          <boxGeometry args={[1.4, 6 + i, 2]} />
          <meshStandardMaterial color="#1f2a30" roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function UtensilRail({ position }: { position: THREE.Vector3Tuple }) {
  const steel = <meshStandardMaterial color="#c9d2d6" metalness={0.8} roughness={0.25} />;
  const wood = <meshStandardMaterial color="#b9844f" roughness={0.6} />;
  return (
    <group position={position}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.35, 0.35, 34, 12]} />
        {steel}
      </mesh>
      {/* Wooden spoon */}
      <group position={[-10, -1, 0.8]}>
        <mesh position={[0, -6, 0]} castShadow>
          <cylinderGeometry args={[0.35, 0.45, 12, 8]} />
          {wood}
        </mesh>
        <mesh position={[0, -13.5, 0]} scale={[1, 1.5, 0.35]} castShadow>
          <sphereGeometry args={[1.8, 14, 10]} />
          {wood}
        </mesh>
      </group>
      {/* Spatula */}
      <group position={[0, -1, 0.8]}>
        <mesh position={[0, -6, 0]} castShadow>
          <cylinderGeometry args={[0.35, 0.35, 12, 8]} />
          {steel}
        </mesh>
        <mesh position={[0, -14.5, 0]} castShadow>
          <boxGeometry args={[4.5, 5, 0.25]} />
          {steel}
        </mesh>
      </group>
      {/* Ladle */}
      <group position={[10, -1, 0.8]}>
        <mesh position={[0, -7, 0]} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 14, 8]} />
          {steel}
        </mesh>
        <mesh position={[0, -15.5, 1.2]} rotation={[Math.PI, 0, 0]} castShadow>
          <sphereGeometry args={[2.6, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {steel}
        </mesh>
      </group>
    </group>
  );
}

export function Kitchen() {
  return (
    <group>
      <Wall />
      <Counter />
      <Window />
      {/* Props sit just behind the board so the default camera frames them. */}
      <FruitBowl position={[-25, COUNTER_TOP, -21]} />
      <KnifeBlock position={[-40, COUNTER_TOP, -27]} />
      <Jars position={[14, COUNTER_TOP, -28]} />
      <Plant position={[36, COUNTER_TOP, -24]} />
      <UtensilRail position={[12, COUNTER_TOP + 30, WALL_Z + 1]} />
    </group>
  );
}
