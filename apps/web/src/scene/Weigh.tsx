import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { CutResult, Plane } from "@slice-even/core";
import { splitGeometry } from "./geometry.ts";
import { haptic, sfx } from "../audio/sfx.ts";

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const grams = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} g`;

const SPLIT_SECONDS = 0.6;
const SLIDE = 0.8;
const TIP = 0.45;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * The balance: a see-saw beam on a short post with a plate on each end,
 * standing just behind where the object was cut. Low, so the halves stay in
 * frame, and behind the cut line, so the knife mark and the ideal line stay
 * visible on the board in front of it.
 */
const SCALE = {
  /** Behind the object's spot (the board's local Z). */
  z: -3.5,
  pivot: 2.4,
  /** Half the beam: each plate's distance from the post. */
  arm: 8,
  /** Plate top above the beam. */
  rise: 0.6,
  plate: 5,
  /** Radians of tilt per unit of (heavier - lighter) / total, capped. */
  gain: THREE.MathUtils.degToRad(140),
  max: THREE.MathUtils.degToRad(12),
} as const;

/** Seconds into the weigh-in: the scale pops up, then each half flies to its plate. */
const WEIGH = { pop: 0.35, firstFlight: 0.25, secondFlight: 0.45, flight: 0.55, labels: 0.5 } as const;

/** Furthest reach of the scale from the board's center, for the camera to fit. */
export const WEIGH_WIDTH = 2 * (SCALE.arm + SCALE.plate) + 3;

interface HalvesProps {
  geometry: THREE.BufferGeometry;
  plane: Plane;
  skin: THREE.Material;
  flesh: THREE.Material;
  bounds: THREE.Box3;
  stem: ReactNode;
  stemBase: THREE.Vector3Tuple;
  /** The cut's masses; with `weigh` the halves go on the balance and it tips. */
  score: CutResult;
  weigh: boolean;
  /**
   * How far the object had turned when it was cut ("spin" rounds), radians
   * about Y. The cut is in the object's own frame; the halves start out
   * turned like the object was, and the balance stays square to the board.
   */
  turn?: number;
}

const easeOutBack = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
const easeInOut = (t: number) => t * t * (3 - 2 * t);

/**
 * The two halves after the cut. First each slides away from the cut and
 * tips outwards, pivoting on its outer bottom edge so it stays on the board.
 * Then, at the weigh-in, the balance pops up behind them, each half hops
 * onto a plate (cut face to the camera) and the beam tips towards the
 * heavier one: the result, before any number is shown.
 */
export function Halves({ geometry, plane, skin, flesh, bounds, stem, stemBase, score, weigh, turn = 0 }: HalvesProps) {
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

  const floor = bounds.min.y;
  const turned = useMemo(() => new THREE.Quaternion().setFromAxisAngle(Y_AXIS, turn), [turn]);
  const sides = useMemo(() => {
    const n = new THREE.Vector3(...plane.normal).normalize();
    const meshes = [halves.front, halves.back];
    const list = ([1, -1] as const).map((sign, i) => {
      const dir = n.clone().multiplyScalar(sign);
      const origin = new THREE.Vector3(...plane.point);
      // How far this half reaches from the cut, from the bounding box corners.
      let reach = 0.5;
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          reach = Math.max(reach, (x - origin.x) * dir.x + (z - origin.z) * dir.z);
        }
      }
      const pivot = origin.addScaledVector(dir, reach).setY(floor);
      // Long pieces (cucumber, bread) barely tip; tipping them far would fling the cut end up.
      const tip = TIP * THREE.MathUtils.clamp(3.5 / reach, 0.12, 1);
      const axis = new THREE.Vector3().crossVectors(Y_AXIS, dir);

      // On the plate the half sits on its own middle, turned to show the cut
      // face to the camera, unless it is long: those stay as they lie.
      const box = meshes[i]!.geometry.boundingBox!;
      const center = new THREE.Vector3((box.min.x + box.max.x) / 2, floor, (box.min.z + box.max.z) / 2);
      // Long means it sticks out from the cut further than the cut face is
      // wide (half a cucumber), not that its box is oblong: half an apple is
      // twice as wide as it is deep and should still turn to face the camera.
      let depth = 0;
      let [left, right] = [Infinity, -Infinity];
      for (const x of [box.min.x, box.max.x]) {
        for (const z of [box.min.z, box.max.z]) {
          depth = Math.max(depth, (x - plane.point[0]) * dir.x + (z - plane.point[2]) * dir.z);
          const across = -x * dir.z + z * dir.x;
          left = Math.min(left, across);
          right = Math.max(right, across);
        }
      }
      const long = depth > 1.25 * (right - left);
      const yaw = long ? turn : -Math.atan2(-dir.x, -dir.z);
      return {
        dir,
        // Where this half points on the board, turn included.
        seen: dir.clone().applyQuaternion(turned),
        pivot,
        splitQuat: new THREE.Quaternion().setFromAxisAngle(axis, tip).premultiply(turned),
        plateQuat: new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw),
        center,
        mass: i === 0 ? score.massFront : score.massBack,
      };
    });
    // Whichever half is further left on screen takes the left plate, and goes first.
    const left = list[0]!.seen.x < -1e-3 || (Math.abs(list[0]!.seen.x) <= 1e-3 && list[0]!.seen.z > 0) ? 0 : 1;
    return list.map((side, i) => ({ ...side, plate: i === left ? -1 : 1, start: i === left ? WEIGH.firstFlight : WEIGH.secondFlight }));
  }, [plane, bounds, floor, halves, score, turn, turned]);

  const stemOnFront =
    (stemBase[0] - plane.point[0]) * plane.normal[0] + (stemBase[2] - plane.point[2]) * plane.normal[2] >= 0;

  const total = score.massFront + score.massBack || 1;
  const finalAngle = useMemo(() => {
    const right = sides.find((s) => s.plate === 1)!.mass;
    const left = sides.find((s) => s.plate === -1)!.mass;
    return THREE.MathUtils.clamp(((right - left) / total) * SCALE.gain, -SCALE.max, SCALE.max);
  }, [sides, total]);

  const outer = [useRef<THREE.Group>(null!), useRef<THREE.Group>(null!)];
  const inner = [useRef<THREE.Group>(null!), useRef<THREE.Group>(null!)];
  const scale = useRef<THREE.Group>(null!);
  const beam = useRef<THREE.Group>(null!);
  const plates = [useRef<THREE.Group>(null!), useRef<THREE.Group>(null!)];
  const sim = useRef({ split: 0, clock: 0, angle: 0, speed: 0, landed: [false, false] }).current;
  const [settled, setSettled] = useState(false);
  const scratch = useMemo(() => ({ plate: new THREE.Vector3(), from: new THREE.Vector3(), offset: new THREE.Vector3() }), []);

  useFrame((_, dt) => {
    sim.split = Math.min(1, sim.split + dt / SPLIT_SECONDS);
    const split = 1 - (1 - sim.split) ** 3;
    if (weigh) sim.clock += dt;

    // The beam is a damped spring towards wherever the weight on it says: hard
    // over while only one half has landed, then the real difference.
    const [a, b] = sim.landed;
    const leftLanded = sides[0]!.plate === -1 ? a : b;
    const rightLanded = sides[0]!.plate === 1 ? a : b;
    const goal = leftLanded && rightLanded ? finalAngle : leftLanded ? -SCALE.max : rightLanded ? SCALE.max : 0;
    // Small fixed steps keep the spring stable whatever the frame rate; after a
    // long stall (a background tab) it is simply at rest.
    if (dt > 1.5) {
      sim.angle = goal;
      sim.speed = 0;
    } else {
      for (let left = dt; left > 0; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120);
        sim.speed += (-(sim.angle - goal) * 70 - sim.speed * 5.5) * h;
        sim.angle += sim.speed * h;
      }
    }

    scale.current.visible = weigh;
    scale.current.scale.setScalar(easeOutBack(Math.min(1, sim.clock / WEIGH.pop)) || 0.001);
    beam.current.rotation.z = -sim.angle;

    sides.forEach((side, i) => {
      // Plate top, in the stage's space: the beam's end, kept level.
      scratch.plate.set(
        side.plate * SCALE.arm * Math.cos(sim.angle),
        floor + SCALE.pivot + SCALE.rise - side.plate * SCALE.arm * Math.sin(sim.angle),
        SCALE.z,
      );
      const plate = plates[side.plate === -1 ? 0 : 1]!.current;
      plate.position.set(scratch.plate.x, scratch.plate.y - floor, 0);

      const flight = THREE.MathUtils.clamp((sim.clock - side.start) / WEIGH.flight, 0, 1);
      if (flight === 1 && !sim.landed[i]) {
        sim.landed[i] = true;
        sfx.clunk();
        haptic(12);
        // Dropping onto the plate gives the beam a shove.
        sim.speed += side.plate * 1.2;
        if (sim.landed[0] && sim.landed[1]) setTimeout(() => setSettled(true), WEIGH.labels * 1000);
      }
      const u = easeInOut(flight);
      scratch.from.copy(side.pivot).addScaledVector(side.dir, SLIDE * split).applyQuaternion(turned);
      const g = outer[i]!.current;
      g.position.lerpVectors(scratch.from, scratch.plate, u);
      g.position.y += Math.sin(Math.PI * flight) * 5;
      g.quaternion.slerpQuaternions(turned, side.splitQuat, split).slerp(side.plateQuat, u);
      inner[i]!.current.position.copy(scratch.offset.lerpVectors(side.pivot, side.center, u)).negate();
    });
  });

  const leftSide = sides.find((s) => s.plate === -1)!;
  const rightSide = sides.find((s) => s.plate === 1)!;

  return (
    <>
      {[halves.front, halves.back].map((mesh, i) => (
        <group key={i} ref={outer[i]}>
          <group ref={inner[i]}>
            <primitive object={mesh} />
            {(i === 0) === stemOnFront && stem}
          </group>
        </group>
      ))}

      <group ref={scale} position={[0, floor, SCALE.z]} visible={false}>
        <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[2.1, 2.6, 0.5, 40]} />
          <meshStandardMaterial color="#0f2a33" roughness={0.45} />
        </mesh>
        <mesh position={[0, SCALE.pivot / 2 + 0.2, 0]} castShadow>
          <cylinderGeometry args={[0.45, 0.6, SCALE.pivot, 20]} />
          <meshStandardMaterial color="#0f2a33" roughness={0.45} />
        </mesh>
        <group ref={beam} position={[0, SCALE.pivot, 0]}>
          <mesh castShadow>
            <boxGeometry args={[SCALE.arm * 2 + 1, 0.55, 1.1]} />
            <meshStandardMaterial color="#0f2a33" roughness={0.45} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.7, 0.7, 1.3, 20]} />
            <meshStandardMaterial color="#fffaf0" roughness={0.5} />
          </mesh>
        </group>
        {(
          [
            ["#ffc93c", leftSide],
            ["#4cc3f0", rightSide],
          ] as const
        ).map(([color, side], i) => (
          <group key={i} ref={plates[i]}>
            <mesh position={[0, -SCALE.rise / 2, 0]}>
              <cylinderGeometry args={[0.5, 0.5, SCALE.rise, 16]} />
              <meshStandardMaterial color="#0f2a33" roughness={0.45} />
            </mesh>
            <mesh position={[0, -0.18, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[SCALE.plate, SCALE.plate - 0.5, 0.36, 48]} />
              <meshStandardMaterial color={color} roughness={0.4} />
            </mesh>
            {settled && (
              <Html position={[0, -0.3, SCALE.plate + 0.2]} center zIndexRange={[4, 0]}>
                <div className="pan-label" style={{ background: color }}>
                  <b>{pct(side.mass / total)}</b>
                  <span>{grams(side.mass)}</span>
                </div>
              </Html>
            )}
          </group>
        ))}
      </group>
    </>
  );
}
