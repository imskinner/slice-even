import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { CutResult, Plane } from "@slice-even/core";
import { splitGeometry } from "./geometry.ts";

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const grams = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} g`;

const SPLIT_SECONDS = 0.6;
const SLIDE = 1.1;
/** Left to right along the cut's normal: the plates' colors, and white for the middle. */
const COLORS = ["#ffc93c", "#fffaf0", "#4cc3f0"];

interface ThirdsProps {
  geometry: THREE.BufferGeometry;
  plane: Plane;
  plane2: Plane;
  skin: THREE.Material;
  flesh: THREE.Material;
  bounds: THREE.Box3;
  stem: ReactNode;
  stemBase: THREE.Vector3Tuple;
  /** massBack, massMid and massFront are the three pieces, along the first cut's normal. */
  score: CutResult;
  /** Show each piece's share. Multiplayer waits until the round is scored. */
  reveal: boolean;
}

/**
 * "Thirds" rounds: two parallel cuts, three pieces. The outer two slide
 * apart and the middle one stays; there is no balance to put three pieces
 * on, so each just gets its share written above it.
 */
export function Thirds({ geometry, plane, plane2, skin, flesh, bounds, stem, stemBase, score, reveal }: ThirdsProps) {
  const cut = useMemo(() => {
    const n = new THREE.Vector3(...plane.normal).normalize();
    const offset = (p: Plane) => new THREE.Vector3(...p.point).dot(n);
    const [lo, hi] = [offset(plane), offset(plane2)].sort((a, b) => a - b) as [number, number];
    const at = (d: number): Plane => ({ point: n.clone().multiplyScalar(d).toArray(), normal: n.toArray() });
    // Behind the lower cut, then what is left split again at the upper one.
    const first = splitGeometry(geometry, at(lo), skin, flesh);
    const second = splitGeometry(first.front.geometry, at(hi), first.front.material, flesh);
    first.front.geometry.dispose();
    const stemAt = new THREE.Vector3(...stemBase).dot(n);
    const meshes = [first.back, second.back, second.front];
    for (const mesh of meshes) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.geometry.computeBoundingBox();
    }
    return { n, meshes, stemPiece: stemAt < lo ? 0 : stemAt > hi ? 2 : 1 };
  }, [geometry, plane, plane2, skin, flesh, stemBase]);
  useEffect(() => () => cut.meshes.forEach((m) => m.geometry.dispose()), [cut]);

  const groups = [useRef<THREE.Group>(null!), useRef<THREE.Group>(null!), useRef<THREE.Group>(null!)];
  const progress = useRef(0);
  useFrame((_, dt) => {
    progress.current = Math.min(1, progress.current + dt / SPLIT_SECONDS);
    const t = 1 - (1 - progress.current) ** 3;
    groups.forEach((g, i) => g.current.position.copy(cut.n).multiplyScalar((i - 1) * SLIDE * t));
  });

  const masses = [score.massBack, score.massMid ?? 0, score.massFront];
  const total = masses.reduce((a, b) => a + b, 0) || 1;

  return (
    <>
      {cut.meshes.map((mesh, i) => {
        const box = mesh.geometry.boundingBox!;
        return (
          <group key={i} ref={groups[i]}>
            <primitive object={mesh} />
            {i === cut.stemPiece && stem}
            {reveal && masses[i]! > 0 && (
              <Html
                position={[(box.min.x + box.max.x) / 2, bounds.max.y + 1.6, (box.min.z + box.max.z) / 2]}
                center
                zIndexRange={[4, 0]}
              >
                <div className="pan-label" style={{ background: COLORS[i] }}>
                  <b>{pct(masses[i]! / total)}</b>
                  <span>{grams(masses[i]!)}</span>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}
