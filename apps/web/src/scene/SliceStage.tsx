import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { AnyGeneratedObject, Plane } from "@slice-even/core";
import { splitGeometry, toBufferGeometry } from "./geometry.ts";
import { Knife } from "./Knife.tsx";
import { createMaterials } from "./materials.ts";
import type { CutOutcome } from "../game.ts";

interface SliceStageProps {
  object: AnyGeneratedObject;
  skinColor: string;
  stemTilt: number;
  outcome: CutOutcome | null;
  onCut(plane: Plane): void;
  /** Hides the knife without a cut (round over, time up). */
  locked?: boolean;
  /** Show where the perfect cut was. Multiplayer waits until the round is scored. */
  revealIdeal?: boolean;
}

/** The object on the board, the knife, and after the cut the two halves. */
export function SliceStage({
  object,
  skinColor,
  stemTilt,
  outcome,
  onCut,
  locked = false,
  revealIdeal = true,
}: SliceStageProps) {
  const geometry = useMemo(() => toBufferGeometry(object.mesh), [object]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const { skin, flesh } = useMemo(() => createMaterials(object, skinColor), [object, skinColor]);
  useEffect(
    () => () => {
      skin.dispose();
      flesh.dispose();
    },
    [skin, flesh],
  );

  const box = geometry.boundingBox!;
  const lift = -box.min.y;
  const center = (box.min.y + box.max.y) / 2;

  const p = object.mesh.positions;
  // The apple generator puts the stem cavity at vertex 0 (the top pole).
  const stemBase: THREE.Vector3Tuple | null = object.kind === "apple" ? [p[0]!, p[1]!, p[2]!] : null;
  const stem = stemBase && <Stem base={stemBase} tilt={stemTilt} />;

  return (
    <group position={[0, lift, 0]}>
      {outcome ? (
        <Halves
          geometry={geometry}
          plane={outcome.plane}
          skin={skin}
          flesh={flesh}
          bounds={box}
          stem={stem}
          stemBase={stemBase}
        />
      ) : (
        <>
          <mesh geometry={geometry} material={skin} castShadow receiveShadow />
          {stem}
        </>
      )}
      {outcome && revealIdeal && <IdealPlane plane={outcome.ideal} height={box.max.y - box.min.y + 2} center={center} />}
      {!(locked && !outcome) && (
        <Knife top={box.max.y} bottom={box.min.y} center={center} lift={lift} active={!outcome} onCut={onCut} />
      )}
    </group>
  );
}

function Stem({ base, tilt }: { base: THREE.Vector3Tuple; tilt: number }) {
  return (
    <group position={base} rotation={[tilt * 0.5, 0, tilt]}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.11, 1.6, 8]} />
        <meshStandardMaterial color="#5a3d22" roughness={0.9} />
      </mesh>
    </group>
  );
}

const SPLIT_SECONDS = 0.6;
const SLIDE = 0.8;
const TIP = 0.45;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

interface HalvesProps {
  geometry: THREE.BufferGeometry;
  plane: Plane;
  skin: THREE.Material;
  flesh: THREE.Material;
  bounds: THREE.Box3;
  stem: ReactNode;
  stemBase: THREE.Vector3Tuple | null;
}

/**
 * Each half slides away from the cut and tips outwards, pivoting on its
 * outer bottom edge so it stays on the board.
 */
function Halves({ geometry, plane, skin, flesh, bounds, stem, stemBase }: HalvesProps) {
  const halves = useMemo(() => splitGeometry(geometry, plane, skin, flesh), [geometry, plane, skin, flesh]);
  useEffect(() => {
    for (const mesh of [halves.front, halves.back]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    return () => {
      halves.front.geometry.dispose();
      halves.back.geometry.dispose();
    };
  }, [halves]);

  const sides = useMemo(() => {
    const n = new THREE.Vector3(...plane.normal).normalize();
    return ([1, -1] as const).map((sign) => {
      const dir = n.clone().multiplyScalar(sign);
      const origin = new THREE.Vector3(...plane.point);
      // How far this half reaches from the cut, from the bounding box corners.
      let reach = 0.5;
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          reach = Math.max(reach, (x - origin.x) * dir.x + (z - origin.z) * dir.z);
        }
      }
      const pivot = origin.addScaledVector(dir, reach).setY(bounds.min.y);
      // Long pieces (cucumber, bread) barely tip; tipping them far would fling the cut end up.
      const tip = TIP * THREE.MathUtils.clamp(3.5 / reach, 0.12, 1);
      return { dir, pivot, tip, axis: new THREE.Vector3().crossVectors(Y_AXIS, dir) };
    });
  }, [plane, bounds]);

  const stemOnFront =
    stemBase !== null &&
    (stemBase[0] - plane.point[0]) * plane.normal[0] + (stemBase[2] - plane.point[2]) * plane.normal[2] >= 0;

  const outer = [useRef<THREE.Group>(null!), useRef<THREE.Group>(null!)];
  const progress = useRef(0);

  useFrame((_, dt) => {
    progress.current = Math.min(1, progress.current + dt / SPLIT_SECONDS);
    const t = 1 - (1 - progress.current) ** 3;
    sides.forEach(({ dir, pivot, tip, axis }, i) => {
      const g = outer[i]!.current;
      g.position.copy(pivot).addScaledVector(dir, SLIDE * t);
      g.quaternion.setFromAxisAngle(axis, tip * t);
    });
  });

  return (
    <>
      {[halves.front, halves.back].map((mesh, i) => (
        <group key={i} ref={outer[i]}>
          <group position={sides[i]!.pivot.clone().negate()}>
            <primitive object={mesh} />
            {(i === 0) === stemOnFront && stem}
          </group>
        </group>
      ))}
    </>
  );
}

/** Where the perfect cut would have been, shown after the round. */
function IdealPlane({ plane, height, center }: { plane: Plane; height: number; center: number }) {
  const quaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...plane.normal).normalize()),
    [plane],
  );
  return (
    // Only a line on the board: a translucent plane would tint the cut faces.
    <mesh position={[plane.point[0], center - height / 2 + 1.01, plane.point[2]]} quaternion={quaternion}>
      <boxGeometry args={[16, 0.03, 0.12]} />
      <meshBasicMaterial color="#1e9e57" />
    </mesh>
  );
}
