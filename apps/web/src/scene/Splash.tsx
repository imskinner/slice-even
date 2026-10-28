import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

interface SplashProps {
  /** Where the blade went through, in the parent's space. */
  origin: THREE.Vector3;
  /** Blade normal (horizontal); droplets fly to both sides of it. */
  normal: THREE.Vector3;
  /** Half-width along the blade and the height range to spawn from. */
  width: number;
  bottom: number;
  top: number;
  /** Droplets stop and flatten here (the board, in parent space). */
  floor: number;
  color: string;
  count?: number;
}

const GRAVITY = 140; // cm/s², toned down so the burst reads at game speed
const LIFE = 1.6;

/** A burst of juice droplets (or crumbs) that fly off the cut and splat on the board. */
export function Splash({ origin, normal, width, bottom, top, floor, color, count = 90 }: SplashProps) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const particles = useMemo(() => {
    const n = normal.clone().setY(0).normalize();
    const t = new THREE.Vector3(-n.z, 0, n.x);
    return Array.from({ length: count }, (_, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const pos = origin
        .clone()
        .addScaledVector(t, (Math.random() * 2 - 1) * width)
        .setY(bottom + (0.35 + 0.65 * Math.random()) * (top - bottom));
      const vel = n
        .clone()
        .multiplyScalar(side * (4 + Math.random() * 16))
        .addScaledVector(t, (Math.random() * 2 - 1) * 6)
        .setY(18 + Math.random() * 32);
      return { pos, vel, size: 0.07 + Math.random() * 0.18, landed: false, delay: Math.random() * 0.08 };
    });
  }, [origin, normal, width, bottom, top, count]);

  const age = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const material = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    age.current += dt;
    const fade = Math.max(0, 1 - Math.max(0, age.current - LIFE * 0.6) / (LIFE * 0.4));
    particles.forEach((p, i) => {
      const live = age.current > p.delay;
      if (live && !p.landed) {
        p.vel.y -= GRAVITY * dt;
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y <= floor + 0.02) {
          p.pos.y = floor + 0.02;
          p.landed = true;
        }
      }
      dummy.position.copy(p.pos);
      const s = live ? p.size * fade : 0;
      // Landed drops spread into flat splats; flying ones stretch along their velocity.
      if (p.landed) dummy.scale.set(s * 2.2, s * 0.25, s * 2.2);
      else dummy.scale.set(s, s * 1.4, s);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.visible = fade > 0;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} material={material} castShadow frustumCulled={false}>
      <icosahedronGeometry args={[1, 1]} />
    </instancedMesh>
  );
}
