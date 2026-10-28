import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { Plane } from "@slice-even/core";
import { sfx } from "../audio/sfx.ts";

interface KnifeProps {
  /** Apple extents in the parent group's local space. */
  top: number;
  bottom: number;
  center: number;
  /** World Y of the parent group, to aim with the mouse at mid-apple height. */
  lift: number;
  /** False once the cut has happened. */
  active: boolean;
  onCut(plane: Plane): void;
}

const BLADE_LENGTH = 16;
const BLADE_HEIGHT = 3.5;
const DROP_SECONDS = 0.22;
const RAISE_SECONDS = 0.5;
const EXIT_HEIGHT = 25;
/** Mouse movement multiplier while Shift is held. */
const PRECISE_FACTOR = 0.15;
const AIM_LIMIT = 10;

/**
 * Vertical knife that follows the mouse over the apple. Wheel or Q/E turn it,
 * arrows nudge it, Shift slows everything down, click or Space cuts.
 * Coordinates are the parent group's (the apple's) local space.
 */
export function Knife({ top, bottom, center, lift, active, onCut }: KnifeProps) {
  const rig = useRef<THREE.Group>(null!);
  const blade = useRef<THREE.Group>(null!);
  const guide = useRef<THREE.Group>(null!);
  const { camera, pointer, gl } = useThree();

  const s = useRef({
    x: 0,
    z: 0,
    angle: 0,
    precise: false,
    lastHit: null as THREE.Vector3 | null,
    /** -1 while aiming, 0..1 while dropping, then back down to 0 while raising. */
    drop: -1,
    fired: false,
  }).current;

  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const aimPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -(lift + center)), [lift, center]);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const hover = top + 1.5;

  useEffect(() => {
    if (!active) return;
    const el = gl.domElement;
    const cut = () => {
      if (s.drop >= 0) return;
      s.drop = 0;
      sfx.whoosh();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      s.angle += e.deltaY * (s.precise ? 0.0003 : 0.0015);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0) cut();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      s.precise = e.shiftKey;
      const step = s.precise ? 0.02 : 0.1; // cm
      const turn = THREE.MathUtils.degToRad(s.precise ? 0.2 : 1);
      switch (e.code) {
        case "Space":
          e.preventDefault();
          cut();
          break;
        case "ArrowLeft":
        case "ArrowDown":
          s.x -= Math.cos(s.angle) * step;
          s.z -= Math.sin(s.angle) * step;
          break;
        case "ArrowRight":
        case "ArrowUp":
          s.x += Math.cos(s.angle) * step;
          s.z += Math.sin(s.angle) * step;
          break;
        case "KeyQ":
          s.angle -= turn;
          break;
        case "KeyE":
          s.angle += turn;
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      s.precise = e.shiftKey;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [active, gl, s]);

  useFrame((_, dt) => {
    if (active && s.drop < 0) {
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(aimPlane, hit)) {
        const last = s.lastHit;
        if (last && s.precise) {
          s.x += (hit.x - last.x) * PRECISE_FACTOR;
          s.z += (hit.z - last.z) * PRECISE_FACTOR;
        } else if (!last || hit.distanceToSquared(last) > 1e-8) {
          // Only follow when the mouse actually moved, so arrow nudges stick.
          s.x = hit.x;
          s.z = hit.z;
        }
        s.lastHit = (last ?? new THREE.Vector3()).copy(hit);
      }
      s.x = THREE.MathUtils.clamp(s.x, -AIM_LIMIT, AIM_LIMIT);
      s.z = THREE.MathUtils.clamp(s.z, -AIM_LIMIT, AIM_LIMIT);
    } else if (s.drop >= 0 && !s.fired) {
      s.drop = Math.min(1, s.drop + dt / DROP_SECONDS);
      if (s.drop === 1) {
        s.fired = true;
        onCut({ point: [s.x, center, s.z], normal: [Math.cos(s.angle), 0, Math.sin(s.angle)] });
      }
    } else if (s.fired) {
      s.drop = Math.max(0, s.drop - dt / RAISE_SECONDS);
    }

    rig.current.position.set(s.x, 0, s.z);
    rig.current.rotation.y = -s.angle;
    const t = Math.max(0, s.drop);
    const eased = s.fired ? t * t * (3 - 2 * t) : t * t;
    // After the cut the knife keeps rising until it leaves the frame.
    const exit = s.fired ? (1 - t) * EXIT_HEIGHT : 0;
    blade.current.position.y = THREE.MathUtils.lerp(hover, bottom - 0.3, eased) + exit;
    guide.current.visible = active && s.drop < 0;
  });

  const guideHeight = top - bottom + 2;

  return (
    <group ref={rig}>
      {/* Local X is the plane normal, Z runs along the blade. */}
      <group ref={blade}>
        <mesh position={[0, BLADE_HEIGHT / 2, 0]} castShadow>
          <boxGeometry args={[0.1, BLADE_HEIGHT, BLADE_LENGTH]} />
          {/* Low metalness: there is no environment map yet for real metal to reflect. */}
          <meshStandardMaterial color="#e6eaee" metalness={0.25} roughness={0.25} />
        </mesh>
        {/* Handle on the far side (-Z) so it does not hide the apple from the default camera. */}
        <mesh position={[0, BLADE_HEIGHT * 0.7, -(BLADE_LENGTH / 2 + 4)]} castShadow>
          <boxGeometry args={[0.9, 1.5, 8]} />
          <meshStandardMaterial color="#3b2a20" roughness={0.7} />
        </mesh>
      </group>
      <group ref={guide}>
        <mesh position={[0, (top + bottom) / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[BLADE_LENGTH - 2, guideHeight]} />
          <meshBasicMaterial color="#ff5a36" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {/* Line on the board: the plane above is invisible when seen edge-on. */}
        <mesh position={[0, bottom + 0.01, 0]}>
          <boxGeometry args={[0.06, 0.02, BLADE_LENGTH + 2]} />
          <meshBasicMaterial color="#ff5a36" />
        </mesh>
      </group>
    </group>
  );
}
