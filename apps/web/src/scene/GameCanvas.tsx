import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { woodMaterial } from "./materials.ts";
import { Kitchen } from "./Kitchen.tsx";
import { TouchControls } from "../ui/TouchControls.tsx";
import { NO_SHIFT, type SceneShift } from "../ui/ResultDock.tsx";
import { WEIGH_WIDTH } from "./Weigh.tsx";
import { ShaderWarmup } from "./ShaderWarmup.tsx";
import { SCENE_KICK } from "./Knife.tsx";
import { setAmbience } from "../audio/sfx.ts";

/**
 * Soft studio reflections without downloading an HDR: three's procedural
 * room, prefiltered once.
 */
export function StudioEnvironment({ intensity = 0.4 }: { intensity?: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    // The procedural room is bright; at full strength it washes colors out.
    scene.environmentIntensity = intensity;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, intensity]);
  return null;
}

function Board() {
  const material = useMemo(() => woodMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <group>
      <mesh position={[0, -0.75, 0]} receiveShadow castShadow material={material}>
        <boxGeometry args={[34, 1.5, 23]} />
      </mesh>
      {/* Juice groove around the edge. */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[14.6, 15, 96, 1]} />
        <meshBasicMaterial color="#7a4a26" transparent opacity={0.18} depthWrite={false} />
      </mesh>
    </group>
  );
}

const TARGET = new THREE.Vector3(0, 1, 1.5);
const FOV = 35;
// The initial camera position sets the angle; this sets how far back it sits.
const BASE_DISTANCE = new THREE.Vector3(0, 15, 26).sub(TARGET).length() * 1.35;
/** Scene width in view at the target, per unit of distance and of aspect ratio. */
const WIDTH_PER_DISTANCE = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2));

/**
 * How far back the camera sits. Wide screens see the whole board, further
 * back for long objects (a banana spans 20+ cm). Upright phones come close
 * instead, so the object and a little room for the knife fill the width:
 * aiming needs to see the object, not the board. For the weigh-in everyone
 * steps back far enough to fit the balance in the part of the screen a
 * results panel leaves free (`freeAspect`: that part's width over the
 * screen's height).
 */
function frameDistance(span: number, aspect: number, freeAspect: number, weighing: boolean): number {
  const wide = BASE_DISTANCE * THREE.MathUtils.clamp((span / 2 + 3) / 10, 1, 1.7);
  // A little further than the board needs: the halves stand taller on the plates.
  if (weighing) return Math.max(wide * 1.22, WEIGH_WIDTH / (WIDTH_PER_DISTANCE * freeAspect));
  if (aspect >= 1.2) return wide;
  const width = Math.max(span * 1.6, span + 7);
  return Math.max(wide, width / (WIDTH_PER_DISTANCE * aspect));
}

/** Keeps the camera at the framing distance along the current orbit direction, easing between framings. */
function FrameCamera({ span, shift, weighing }: { span: number; shift: SceneShift; weighing: boolean }) {
  const { camera, size } = useThree();
  const height = Math.max(1, size.height);
  const target = frameDistance(span, size.width / height, Math.max(120, size.width - 2 * shift.x) / height, weighing);
  const offset = useMemo(() => new THREE.Vector3(), []);
  const placed = useRef(false);
  useFrame((_, dt) => {
    const now = offset.copy(camera.position).sub(TARGET).length();
    if (Math.abs(now - target) < 0.01) {
      placed.current = true;
      return;
    }
    // The first frame jumps straight there; later changes (a new object, the weigh-in) glide.
    const next = placed.current ? now + (target - now) * (1 - Math.exp(-dt * 6)) : target;
    placed.current = true;
    camera.position.copy(TARGET).add(offset.setLength(next));
    camera.lookAt(TARGET);
  });
  return null;
}

/**
 * How far down the picture slides for the weigh-in, as a share of the screen's
 * height; less when a sheet already covers the lower part of the screen.
 */
const WEIGH_DROP = { open: 0.1, sheet: 0.055 } as const;

/**
 * Slides the picture (not the camera) so the board stays in view next to a
 * results panel: `shift` is how many pixels left and up the scene moves.
 * Eased, so the scene glides aside as the panel comes in. The same trick
 * gives the knife its kick: a few pixels of shake when the blade lands.
 */
function ShiftView({ shift, weighing }: { shift: SceneShift; weighing: boolean }) {
  const { camera, size } = useThree();
  const current = useRef({ x: 0, y: 0 });
  const applied = useRef("");
  const kick = useRef(Infinity);
  useEffect(() => {
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const onKick = () => {
      if (!calm) kick.current = 0;
    };
    window.addEventListener(SCENE_KICK, onKick);
    return () => window.removeEventListener(SCENE_KICK, onKick);
  }, []);
  useFrame((_, dt) => {
    const c = current.current;
    const k = 1 - Math.exp(-dt * 7);
    // The balance stands behind the board, so higher on screen: for the
    // weigh-in the picture comes down a little to keep the halves in view.
    const drop = shift.y > size.height * 0.15 ? WEIGH_DROP.sheet : WEIGH_DROP.open;
    const wantY = Math.round(shift.y - (weighing ? drop * size.height : 0));
    c.x = Math.abs(shift.x - c.x) < 0.5 ? shift.x : c.x + (shift.x - c.x) * k;
    c.y = Math.abs(wantY - c.y) < 0.5 ? wantY : c.y + (wantY - c.y) * k;
    // A damped bounce, gone in a quarter of a second.
    kick.current += dt;
    const jolt = kick.current < 0.3 ? Math.round(9 * Math.exp(-kick.current * 16) * Math.cos(kick.current * 50)) : 0;
    // Also re-applied when the canvas is resized.
    const key = `${c.x}:${c.y}:${jolt}:${size.width}:${size.height}`;
    if (key === applied.current) return;
    applied.current = key;
    const cam = camera as THREE.PerspectiveCamera;
    if (c.x === 0 && c.y === 0 && jolt === 0) cam.clearViewOffset();
    else cam.setViewOffset(size.width, size.height, c.x, c.y - jolt, size.width, size.height);
  });
  return null;
}

/**
 * Holds the scene back until its shaders are compiled. Drawing something
 * for the first time compiles its shader on the spot, and the kitchen has
 * about twenty: shown straight away, the page froze for a moment on the way
 * in. Compiled in the background instead, the interface stays alive and the
 * scene appears when it can be drawn without a hitch. After that the other
 * objects' shaders are warmed up one by one.
 */
function SceneGate({ children }: { children: ReactNode }) {
  const { gl, scene, camera } = useThree();
  const group = useRef<THREE.Group>(null!);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let gone = false;
    const open = () => {
      if (!gone) setReady(true);
    };
    // A moment, so the environment map and the lights are in place: programs depend on them.
    const id = setTimeout(() => {
      gl.compileAsync(group.current, camera, scene).then(open, open);
    }, 30);
    return () => {
      gone = true;
      clearTimeout(id);
    };
  }, [gl, scene, camera]);
  return (
    <>
      <group ref={group} visible={ready}>
        {children}
      </group>
      {ready && <ShaderWarmup />}
    </>
  );
}

/**
 * Cutting board, lights and camera shared by practice and multiplayer.
 * `span` is the object's largest horizontal size, cm, for framing; `shift`
 * moves the scene out from under a results panel; `weighing` makes room for
 * the balance. One canvas serves a whole visit to a screen: objects come and
 * go inside it, so the kitchen is never rebuilt between rounds.
 */
export function GameCanvas({
  children,
  span = 9,
  shift = NO_SHIFT,
  weighing = false,
}: {
  children?: ReactNode;
  span?: number;
  shift?: SceneShift;
  weighing?: boolean;
}) {
  // The kitchen hums while a game screen is up.
  useEffect(() => {
    setAmbience(true);
    return () => setAmbience(false);
  }, []);
  return (
    <>
      <Canvas shadows="percentage" camera={{ position: [0, 15, 26], fov: FOV }} gl={{ alpha: true }}>
        <FrameCamera span={span} shift={shift} weighing={weighing} />
        <ShiftView shift={shift} weighing={weighing} />
        <StudioEnvironment />
        {/* Distant parts of the kitchen fade into the wall color. */}
        <fog attach="fog" args={["#0f5c66", 90, 210]} />
        <hemisphereLight args={["#fff4e6", "#1d6e73", 0.3]} />
        <directionalLight
          position={[16, 36, 20]}
          intensity={1.9}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-34}
          shadow-camera-right={34}
          shadow-camera-top={30}
          shadow-camera-bottom={-30}
          shadow-camera-far={120}
          shadow-bias={-0.0005}
          shadow-radius={4}
        />
        {/* Warm daylight from the window side. */}
        <directionalLight position={[-30, 20, -10]} intensity={0.8} color="#ffd29a" />
        <SceneGate>
          <Kitchen />
          <Board />
          {children}
        </SceneGate>
        <OrbitControls
          target={TARGET.toArray()}
          enableZoom={false}
          enablePan={false}
          minPolarAngle={0.2}
          maxPolarAngle={1.35}
          // Keep the camera in front of the board: swinging round would put it behind the wall.
          minAzimuthAngle={-1.2}
          maxAzimuthAngle={1.2}
          mouseButtons={{ LEFT: undefined, MIDDLE: undefined, RIGHT: THREE.MOUSE.ROTATE }}
          // One finger aims the knife; two fingers orbit.
          touches={{ ONE: undefined, TWO: THREE.TOUCH.DOLLY_ROTATE }}
        />
      </Canvas>
      <TouchControls />
    </>
  );
}
