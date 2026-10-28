import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

/** Kitchen table, lights and camera shared by practice and multiplayer. */
export function GameCanvas({ children }: { children?: ReactNode }) {
  return (
    <Canvas shadows camera={{ position: [0, 17, 24], fov: 35 }}>
      <color attach="background" args={["#efe9df"]} />
      <hemisphereLight args={["#ffffff", "#8a6a4a", 1.3]} />
      <directionalLight
        position={[8, 18, 10]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-bias={-0.0005}
      />
      <mesh position={[0, -0.6, 0]} receiveShadow>
        <boxGeometry args={[32, 1.2, 22]} />
        <meshStandardMaterial color="#c89b63" roughness={0.8} />
      </mesh>
      {children}
      <OrbitControls
        target={[0, 1, 1.5]}
        enableZoom={false}
        enablePan={false}
        minPolarAngle={0.2}
        maxPolarAngle={1.35}
        mouseButtons={{ LEFT: undefined, MIDDLE: undefined, RIGHT: THREE.MOUSE.ROTATE }}
      />
    </Canvas>
  );
}
