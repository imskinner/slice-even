import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { Plane } from "@slice-even/core";
import { haptic, sfx } from "../audio/sfx.ts";
import { RoundedBox } from "@react-three/drei";
import { selectedSkin } from "../progress/skins.ts";

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
  /** Called with the knife position whenever it moves while aiming (multiplayer ghosts). */
  onAim?(x: number, z: number, angle: number): void;
}

const BLADE_LENGTH = 16;
const BLADE_HEIGHT = 3.5;
const DROP_SECONDS = 0.22;
const RAISE_SECONDS = 0.5;
const EXIT_HEIGHT = 25;
/** Mouse movement multiplier while Shift is held. */
const PRECISE_FACTOR = 0.15;
/** Finger drags move the knife relative to where it is, a bit slower than the finger. */
const TOUCH_FACTOR = 0.6;
const AIM_LIMIT = 10;

/**
 * Window events for on-screen controls (touch): turn the knife, cut, and
 * the knife announcing whether it is waiting for a cut.
 */
export const KNIFE_TURN = "knife:turn";
export const KNIFE_CUT = "knife:cut";
export const KNIFE_STATE = "knife:state";

/** Asks the scene for a short screen shake (see ShiftView in GameCanvas). */
export const SCENE_KICK = "scene:kick";

/** The blade stops for this long as it first bites into the object. */
const BITE_SECONDS = 0.055;

/**
 * A chef's knife seen from the side: straight edge along the bottom, belly
 * curving up to the tip, straight spine. Tall skins (the cleaver) are a
 * plain rectangle. Thin along X (the cut's normal), long along Z.
 */
function bladeGeometry(height: number, cleaver: boolean): THREE.BufferGeometry {
  const half = BLADE_LENGTH / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-half, 0);
  if (cleaver) {
    shape.lineTo(half, 0);
    shape.lineTo(half, height);
  } else {
    shape.lineTo(half - 4, 0);
    shape.quadraticCurveTo(half - 0.6, 0.15, half, height * 0.62);
    shape.quadraticCurveTo(half - 1.2, height, half - 4.5, height);
  }
  shape.lineTo(-half, height);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.05,
    bevelSegments: 1,
    curveSegments: 14,
  });
  // The shape was drawn in XY and extruded along Z: stand it along Z, thin along X.
  geometry.translate(0, 0, -0.05);
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}

/**
 * Vertical knife that follows the mouse over the apple. Wheel or Q/E turn it,
 * arrows nudge it, Shift slows everything down, click or Space cuts.
 * On touch screens a finger drags it (relative, so the finger never covers
 * the cut) and the TouchControls buttons turn it and cut.
 * Coordinates are the parent group's (the apple's) local space.
 */
export function Knife({ top, bottom, center, lift, active, onCut, onAim }: KnifeProps) {
  const lastAim = useRef({ x: NaN, z: NaN, angle: NaN });
  // The chosen cosmetic knife (Records screen); read once per round.
  const [skin] = useState(selectedSkin);
  const bladeHeight = BLADE_HEIGHT * skin.height;
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
    /** Last input was a finger; a finger is down right now. */
    touch: false,
    fingerDown: false,
    /** -1 while aiming, 0..1 while dropping, then back down to 0 while raising. */
    drop: -1,
    fired: false,
    /** Seconds left of the pause as the blade bites; -1 once it has happened. */
    bite: 0,
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
      s.touch = e.pointerType === "touch";
      if (s.touch) {
        // Touching only grabs the knife; the Cut button cuts.
        s.fingerDown = e.isPrimary;
        s.lastHit = null;
        return;
      }
      if (e.button === 0) cut();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch" && e.isPrimary) s.fingerDown = false;
    };
    const onTurn = (e: Event) => {
      s.angle += (e as CustomEvent<number>).detail;
    };
    window.dispatchEvent(new CustomEvent(KNIFE_STATE, { detail: true }));
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
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener(KNIFE_TURN, onTurn);
    window.addEventListener(KNIFE_CUT, cut);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener(KNIFE_TURN, onTurn);
      window.removeEventListener(KNIFE_CUT, cut);
      window.dispatchEvent(new CustomEvent(KNIFE_STATE, { detail: false }));
    };
  }, [active, gl, s]);

  useFrame((_, dt) => {
    if (active && s.drop < 0 && (!s.touch || s.fingerDown)) {
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(aimPlane, hit)) {
        const last = s.lastHit;
        const relative = s.touch ? TOUCH_FACTOR : s.precise ? PRECISE_FACTOR : 0;
        if (last && relative) {
          s.x += (hit.x - last.x) * relative;
          s.z += (hit.z - last.z) * relative;
        } else if (s.touch) {
          // First frame of a drag: just remember where the finger is.
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
      // A beat of resistance as the edge meets the object, then straight through.
      const contact = Math.sqrt((hover - top) / (hover - bottom + 0.3));
      if (s.bite > 0) s.bite -= dt;
      else {
        const before = s.drop;
        s.drop = Math.min(1, s.drop + dt / DROP_SECONDS);
        if (s.bite === 0 && before < contact && s.drop >= contact) {
          s.drop = contact;
          s.bite = BITE_SECONDS;
        } else if (s.bite <= 0 && before >= contact) s.bite = -1;
      }
      if (s.drop === 1) {
        s.fired = true;
        haptic(22);
        window.dispatchEvent(new Event(SCENE_KICK));
        onCut({ point: [s.x, center, s.z], normal: [Math.cos(s.angle), 0, Math.sin(s.angle)] });
      }
    } else if (s.fired) {
      s.drop = Math.max(0, s.drop - dt / RAISE_SECONDS);
    }

    if (onAim && active && s.drop < 0) {
      const last = lastAim.current;
      if (last.x !== s.x || last.z !== s.z || last.angle !== s.angle) {
        lastAim.current = { x: s.x, z: s.z, angle: s.angle };
        onAim(s.x, s.z, s.angle);
      }
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
  const blade3d = useMemo(() => bladeGeometry(bladeHeight, skin.height >= 1.5), [bladeHeight, skin.height]);
  useEffect(() => () => blade3d.dispose(), [blade3d]);

  return (
    <group ref={rig}>
      {/* Local X is the plane normal, Z runs along the blade. */}
      <group ref={blade}>
        <mesh geometry={blade3d} castShadow>
          <meshStandardMaterial
            color={skin.blade.color}
            metalness={skin.blade.metalness}
            roughness={skin.blade.roughness}
            emissive={skin.blade.emissive ?? "#000000"}
            emissiveIntensity={skin.blade.emissive ? 0.8 : 0}
          />
        </mesh>
        {/* Bolster and handle on the far side (-Z) so they do not hide the object from the default camera. */}
        <mesh position={[0, bladeHeight * 0.62, -(BLADE_LENGTH / 2 + 0.3)]} castShadow>
          <boxGeometry args={[0.5, Math.min(2.2, bladeHeight * 0.75), 0.7]} />
          <meshStandardMaterial color={skin.blade.color} metalness={0.6} roughness={0.3} />
        </mesh>
        <RoundedBox
          args={[0.95, 1.5, 7.4]}
          radius={0.4}
          smoothness={3}
          position={[0, bladeHeight * 0.62, -(BLADE_LENGTH / 2 + 4.2)]}
          castShadow
        >
          <meshStandardMaterial color={skin.handle.color} metalness={skin.handle.metalness ?? 0} roughness={0.6} />
        </RoundedBox>
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
