import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { AnyGeneratedObject, Plane } from "@slice-even/core";
import { toBufferGeometry } from "./geometry.ts";
import { Knife } from "./Knife.tsx";
import { createMaterials } from "./materials.ts";
import { Decoration } from "./Decoration.tsx";
import { Splash } from "./Splash.tsx";
import { Halves } from "./Weigh.tsx";
import { sfx } from "../audio/sfx.ts";
import type { CutOutcome } from "../game.ts";
import type { Ghost } from "../net/rooms.ts";

interface SliceStageProps {
  object: AnyGeneratedObject;
  skinColor: string;
  stemTilt: number;
  outcome: CutOutcome | null;
  onCut(plane: Plane): void;
  /** Hides the knife without a cut (round over, time up). */
  locked?: boolean;
  /**
   * The weigh-in: the halves go on the balance and the perfect cut is drawn
   * on the board. Multiplayer waits until the round is scored.
   */
  revealIdeal?: boolean;
  /** Cover the object with a cloche this many ms after mounting, until it is cut (blind rounds). */
  hideAfterMs?: number;
  /** Other players' cuts on this same object (twin rounds), drawn as colored lines. */
  otherCuts?: OtherCut[];
  /** Forwarded to the knife: your aim, for the others' ghost knives. */
  onAim?(x: number, z: number, angle: number): void;
  /** Other players still aiming: live positions by id, plus how to label them. */
  ghosts?: { positions: React.RefObject<Map<string, Ghost>>; players: GhostPlayer[] };
  /** Slide everything off the board: the next object is about to arrive. */
  leaving?: boolean;
  /** No landing sound (the lobby's showcase would thud every few seconds). */
  quiet?: boolean;
}

export interface GhostPlayer {
  id: string;
  name: string;
  color: string;
  /** Bots send no aim: wander around the object instead, differently for each seed. */
  wander?: number;
}

export interface OtherCut {
  plane: Plane;
  color: string;
  name: string;
}

const ENTER_SECONDS = 0.55;
const ENTER_HEIGHT = 11;
const LEAVE_SECONDS = 0.5;

/** Falls, hits, and settles after two small bounces. */
function bounce(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

/**
 * The object on the board, the knife, and after the cut the two halves.
 * The object drops onto the board when it arrives; the knife only wakes up
 * once it has landed.
 */
export function SliceStage({
  object,
  skinColor,
  stemTilt,
  outcome,
  onCut,
  locked = false,
  revealIdeal = true,
  hideAfterMs,
  otherCuts = [],
  onAim,
  ghosts,
  leaving = false,
  quiet = false,
}: SliceStageProps) {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (hideAfterMs === undefined) return;
    const id = setTimeout(() => setCovered(true), hideAfterMs);
    return () => clearTimeout(id);
  }, [hideAfterMs]);
  const geometry = useMemo(() => toBufferGeometry(object.mesh), [object]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const { skin, flesh, splash } = useMemo(() => createMaterials(object, skinColor), [object, skinColor]);
  const handleCut = (plane: Plane) => {
    sfx.cut(object.kind);
    onCut(plane);
  };
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
  // Vertex 0 is the top pole (round shapes) or the -X tip (swept shapes).
  const stemBase: THREE.Vector3Tuple = [p[0]!, p[1]!, p[2]!];
  const stem = <Decoration kind={object.kind} anchor={stemBase} tilt={stemTilt} />;

  const burst = useMemo(() => {
    if (!outcome) return null;
    const n = new THREE.Vector3(...outcome.plane.normal);
    const t = new THREE.Vector3(-n.z, 0, n.x);
    // Half the object's extent along the blade.
    const width = Math.abs(t.x) * (box.max.x - box.min.x) * 0.3 + Math.abs(t.z) * (box.max.z - box.min.z) * 0.3;
    return { origin: new THREE.Vector3(...outcome.plane.point), normal: n, width };
  }, [outcome, box]);

  // Blind rounds: half an ellipsoid big enough to hold the object's bounding
  // cylinder (a flat-topped cake reaches right into the corners), with room to spare.
  const dome = useMemo<THREE.Vector3Tuple | null>(
    () =>
      hideAfterMs === undefined
        ? null
        : [
            ((box.max.x - box.min.x) / 2) * 1.45 + 0.5,
            (box.max.y - box.min.y) * 1.45 + 0.3,
            ((box.max.z - box.min.z) / 2) * 1.45 + 0.5,
          ],
    [hideAfterMs, box],
  );

  // Arriving: skipped when the page opens on an object that is already cut.
  const root = useRef<THREE.Group>(null!);
  const whole = useRef<THREE.Group>(null);
  const motion = useRef({ enter: outcome ? 1 : 0, thud: false, leave: 0 }).current;
  const [landed, setLanded] = useState(!!outcome);
  // The knife wakes up when the object touches down. On a timer, not on a
  // rendered frame: a tab that is not being drawn must still let you cut.
  useEffect(() => {
    const id = setTimeout(() => setLanded(true), (ENTER_SECONDS / 2.75) * 1000);
    return () => clearTimeout(id);
  }, []);
  // Wall-clock time, not capped per frame: in a throttled tab the object must still land on time.
  useFrame((_, dt) => {
    if (motion.enter < 1) {
      motion.enter = Math.min(1, motion.enter + dt / ENTER_SECONDS);
      // First contact with the board, a third of the way in.
      if (motion.enter >= 1 / 2.75 && !motion.thud) {
        motion.thud = true;
        if (!quiet) sfx.thud();
      }
    }
    if (whole.current) whole.current.position.y = (1 - bounce(motion.enter)) * ENTER_HEIGHT;
    if (leaving && motion.leave < 1) {
      if (motion.leave === 0 && !quiet) sfx.whoosh(0.5);
      motion.leave = Math.min(1, motion.leave + dt / LEAVE_SECONDS);
    }
    root.current.position.x = motion.leave ** 2 * 60;
  });

  return (
    <group position={[0, lift, 0]}>
      <group ref={root}>
        {outcome ? (
          <Halves
            geometry={geometry}
            plane={outcome.plane}
            skin={skin}
            flesh={flesh}
            bounds={box}
            stem={stem}
            stemBase={stemBase}
            score={outcome.score}
            weigh={revealIdeal}
          />
        ) : (
          <group ref={whole} position={[0, ENTER_HEIGHT, 0]}>
            <mesh geometry={geometry} material={skin} castShadow receiveShadow />
            {stem}
          </group>
        )}
        {dome && (
          <Cloche
            down={covered && !outcome && !locked}
            // Lifts when the knife lands, or when the round ends without a cut.
            gone={!!outcome || locked}
            size={dome}
            floor={box.min.y}
          />
        )}
        {burst && (
          <Splash
            origin={burst.origin}
            normal={burst.normal}
            width={burst.width}
            bottom={box.min.y}
            top={box.max.y}
            floor={box.min.y}
            color={splash}
            onLand={() => sfx.splat(object.kind)}
          />
        )}
        {outcome && <KnifeMark plane={outcome.plane} floor={box.min.y} />}
        {outcome &&
          revealIdeal &&
          otherCuts.map((c, i) => (
            <CutMark key={i} cut={c} floor={box.min.y} reach={Math.max(box.max.x - box.min.x, box.max.z - box.min.z)} />
          ))}
        {outcome && revealIdeal && <IdealPlane plane={outcome.ideal} height={box.max.y - box.min.y + 2} center={center} />}
      </group>
      {ghosts?.players.map((g) => (
        <GhostKnife
          key={g.id}
          player={g}
          positions={ghosts.positions}
          hover={box.max.y + 1.5}
          reach={Math.max(box.max.x - box.min.x, box.max.z - box.min.z)}
        />
      ))}
      {!(locked && !outcome) && (
        <Knife
          // Over a dome the blade waits above the dome, not inside it.
          top={dome ? box.min.y + dome[1] : box.max.y}
          bottom={box.min.y}
          center={center}
          lift={lift}
          active={!outcome && landed}
          onCut={handleCut}
          onAim={onAim}
        />
      )}
    </group>
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

/**
 * The scar the blade left on the board: once the halves are on the balance,
 * this is what the ideal line (and the others' cuts) are compared against.
 */
function KnifeMark({ plane, floor }: { plane: Plane; floor: number }) {
  const quaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...plane.normal).normalize()),
    [plane],
  );
  return (
    <mesh position={[plane.point[0], floor + 0.012, plane.point[2]]} quaternion={quaternion}>
      <boxGeometry args={[14, 0.02, 0.09]} />
      <meshBasicMaterial color="#3a2110" transparent opacity={0.7} />
    </mesh>
  );
}

/** Another player's cut: a line on the board in their color, with their name at one end. */
function CutMark({ cut, floor, reach }: { cut: OtherCut; floor: number; reach: number }) {
  const quaternion = useMemo(
    () =>
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...cut.plane.normal).normalize()),
    [cut.plane],
  );
  const length = reach + 6;
  return (
    <group position={[cut.plane.point[0], floor + 0.02, cut.plane.point[2]]} quaternion={quaternion}>
      <mesh>
        <boxGeometry args={[length, 0.03, 0.1]} />
        <meshBasicMaterial color={cut.color} />
      </mesh>
      <Html position={[length / 2 + 0.5, 0, 0]} center zIndexRange={[4, 0]}>
        <div className="cut-label" style={{ borderColor: cut.color }}>
          {cut.name}
        </div>
      </Html>
    </group>
  );
}

const CLOCHE_HEIGHT = 22;

/**
 * Blind rounds: a serving dome comes down over the object, and the cut is
 * made through it from memory. It lifts away when the knife lands.
 */
function Cloche({
  down,
  gone,
  size,
  floor,
}: {
  down: boolean;
  gone: boolean;
  /** The dome's radii along X, its height, and along Z. */
  size: THREE.Vector3Tuple;
  floor: number;
}) {
  const group = useRef<THREE.Group>(null!);
  const state = useRef({ y: CLOCHE_HEIGHT, shown: false, clanged: false }).current;
  useFrame((_, dt) => {
    if (gone) state.y += dt * 90;
    else if (down) {
      state.shown = true;
      state.y = Math.max(0, state.y - dt * 45);
      if (state.y === 0 && !state.clanged) {
        state.clanged = true;
        sfx.clang();
      }
    }
    group.current.position.y = floor + state.y;
    // Cut before it came down: there is no dome to lift.
    group.current.visible = state.shown && state.y < 60;
  });
  return (
    <group ref={group} visible={false}>
      <mesh scale={size} castShadow>
        <sphereGeometry args={[1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#dfe5ea" metalness={0.85} roughness={0.22} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, size[1] + 0.45, 0]} castShadow>
        <sphereGeometry args={[0.75, 24, 16]} />
        <meshStandardMaterial color="#dfe5ea" metalness={0.85} roughness={0.22} />
      </mesh>
    </group>
  );
}

/** Updates older than this hide the ghost (the player stopped aiming or left). */
const GHOST_STALE_MS = 1500;

/**
 * Another player's knife, see-through and in their color, following the aim
 * they broadcast. Smoothed, since updates arrive about ten times a second.
 * Bots broadcast nothing, so theirs wanders over the object by itself.
 */
function GhostKnife({
  player,
  positions,
  hover,
  reach,
}: {
  player: GhostPlayer;
  positions: React.RefObject<Map<string, Ghost>>;
  hover: number;
  reach: number;
}) {
  const group = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    let x: number, z: number, angle: number;
    if (player.wander !== undefined) {
      const t = clock.elapsedTime;
      const s = player.wander;
      const r = reach * 0.16;
      x = Math.sin(t * 0.7 + s) * r + Math.sin(t * 1.9 + s * 2.3) * r * 0.3;
      z = Math.cos(t * 0.5 + s * 1.3) * r * 0.6;
      angle = Math.sin(t * 0.4 + s * 3.1) * 1.1;
      group.current.visible = true;
    } else {
      const g = positions.current?.get(player.id);
      const live = !!g && performance.now() - g.at < GHOST_STALE_MS;
      group.current.visible = live;
      if (!g || !live) return;
      ({ x, z, angle } = g);
    }
    group.current.position.x += (x - group.current.position.x) * 0.3;
    group.current.position.z += (z - group.current.position.z) * 0.3;
    group.current.rotation.y += (-angle - group.current.rotation.y) * 0.3;
  });
  return (
    <group ref={group} visible={false}>
      {/* A bot's is smaller and fainter: it is there for company, not for information. */}
      <mesh position={[0, hover + 1.75, 0]} scale={player.wander === undefined ? 1 : 0.65}>
        <boxGeometry args={[0.08, 3.5, 16]} />
        <meshBasicMaterial
          color={player.color}
          transparent
          opacity={player.wander === undefined ? 0.35 : 0.2}
          depthWrite={false}
        />
      </mesh>
      <Html position={[0, hover + 4.2, 0]} center zIndexRange={[4, 0]}>
        <div className="cut-label" style={{ borderColor: player.color }}>
          {player.name}
        </div>
      </Html>
    </group>
  );
}
