import { useEffect, useMemo, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { woodMaterial } from "./materials.ts";

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
const BASE_DISTANCE = new THREE.Vector3(0, 17, 24).sub(TARGET).length();

/**
 * Pulls the camera back for long objects (a banana spans 20+ cm) and narrow
 * screens, keeping the current orbit direction.
 */
function FrameCamera({ span }: { span: number }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const k = THREE.MathUtils.clamp((span / 2 + 3) / 10, 1, 1.7) / Math.min(1, aspect / 1.2);
    const offset = camera.position.clone().sub(TARGET).setLength(BASE_DISTANCE * k);
    camera.position.copy(TARGET).add(offset);
    camera.lookAt(TARGET);
  }, [camera, span, size.width, size.height]);
  return null;
}

/**
 * Cutting board, lights and camera shared by practice and multiplayer.
 * `span` is the object's largest horizontal size, cm, for framing.
 */
export function GameCanvas({ children, span = 9 }: { children?: ReactNode; span?: number }) {
  return (
    <Canvas shadows="percentage" camera={{ position: [0, 17, 24], fov: 35 }} gl={{ alpha: true }}>
      <FrameCamera span={span} />
      <StudioEnvironment />
      <hemisphereLight args={["#fff4e6", "#5e17a8", 0.25]} />
      <directionalLight
        position={[8, 18, 10]}
        intensity={1.9}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-bias={-0.0005}
        shadow-radius={4}
      />
      {/* Warm rim light from behind so silhouettes pop against the purple. */}
      <directionalLight position={[-10, 8, -14]} intensity={0.9} color="#ffd29a" />
      <Board />
      {children}
      <OrbitControls
        target={TARGET.toArray()}
        enableZoom={false}
        enablePan={false}
        minPolarAngle={0.2}
        maxPolarAngle={1.35}
        mouseButtons={{ LEFT: undefined, MIDDLE: undefined, RIGHT: THREE.MOUSE.ROTATE }}
      />
    </Canvas>
  );
}
