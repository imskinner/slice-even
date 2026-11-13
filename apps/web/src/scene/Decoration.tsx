import type { ObjectKind } from "@slice-even/core";
import type * as THREE from "three";

/**
 * Cosmetic bits that are not part of the scored mesh: stems, leaves, a
 * cherry. Anchored at mesh vertex 0, which is the top pole for round shapes
 * and the -X tip for swept ones (the carrot's crown).
 */
export function Decoration({ kind, anchor, tilt }: { kind: ObjectKind; anchor: THREE.Vector3Tuple; tilt: number }) {
  switch (kind) {
    case "apple":
      return (
        <group position={anchor} rotation={[tilt * 0.5, 0, tilt]}>
          <mesh position={[0, 0.7, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.11, 1.6, 8]} />
            <meshStandardMaterial color="#5a3d22" roughness={0.9} />
          </mesh>
          <mesh position={[0.45, 1.1, 0]} rotation={[0, 0, -1.0]} scale={[1, 0.18, 0.5]} castShadow>
            <sphereGeometry args={[0.55, 12, 8]} />
            <meshStandardMaterial color="#4d9a2a" roughness={0.6} />
          </mesh>
        </group>
      );
    case "orange":
      return (
        <group position={anchor}>
          <mesh position={[0, 0.06, 0]} castShadow>
            <cylinderGeometry args={[0.18, 0.28, 0.2, 10]} />
            <meshStandardMaterial color="#6b7a2a" roughness={0.8} />
          </mesh>
        </group>
      );
    case "tomato":
      return (
        <group position={anchor} rotation={[0, tilt * 4, 0]}>
          {Array.from({ length: 5 }, (_, i) => (
            <group key={i} rotation={[0, (i / 5) * Math.PI * 2, 0]}>
              {/* Sepals droop outwards from the stem. */}
              <mesh position={[0.75, -0.02, 0]} rotation={[0, 0, -0.35]} scale={[1, 0.12, 0.32]} castShadow>
                <sphereGeometry args={[0.8, 10, 6]} />
                <meshStandardMaterial color="#3f8f2a" roughness={0.55} />
              </mesh>
            </group>
          ))}
          <mesh position={[0, 0.35, 0]} rotation={[0, 0, tilt]} castShadow>
            <cylinderGeometry args={[0.07, 0.1, 0.8, 8]} />
            <meshStandardMaterial color="#3a7a24" roughness={0.6} />
          </mesh>
        </group>
      );
    case "carrot":
      return (
        <group position={anchor} rotation={[0, 0, Math.PI / 2 + 0.25]}>
          {Array.from({ length: 6 }, (_, i) => {
            const spread = (i / 5 - 0.5) * 1.1;
            return (
              <mesh key={i} position={[Math.sin(spread) * 1.6, 1.6, Math.cos(i * 2.3) * 0.3]} rotation={[0, 0, -spread]} castShadow>
                <cylinderGeometry args={[0.04, 0.09, 3.4, 6]} />
                <meshStandardMaterial color="#3e9b2f" roughness={0.6} />
              </mesh>
            );
          })}
        </group>
      );
    case "cake":
      return (
        <group position={anchor}>
          <mesh position={[0, 0.75, 0]} castShadow>
            <sphereGeometry args={[0.8, 20, 14]} />
            <meshPhysicalMaterial color="#c8102e" roughness={0.15} clearcoat={1} clearcoatRoughness={0.05} />
          </mesh>
          <mesh position={[0.2, 1.9, 0]} rotation={[0, 0, -0.35]} castShadow>
            <cylinderGeometry args={[0.04, 0.05, 1.2, 6]} />
            <meshStandardMaterial color="#4a6a1f" roughness={0.7} />
          </mesh>
        </group>
      );
    case "pepper":
      return (
        // A stout stem, bent a little, on a small green cap in the dimple.
        <group position={anchor} rotation={[tilt * 0.6, tilt * 3, tilt * 0.8]}>
          <mesh position={[0, 0.1, 0]} castShadow>
            <cylinderGeometry args={[0.75, 1.0, 0.35, 12]} />
            <meshStandardMaterial color="#3c7d22" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.95, 0]} castShadow>
            <cylinderGeometry args={[0.28, 0.4, 1.6, 10]} />
            <meshStandardMaterial color="#4a8f28" roughness={0.55} />
          </mesh>
        </group>
      );
    case "eggplant":
      return (
        // The cap: a stem and five sepals lying back along the fruit. Local +Y points away from it (-X).
        <group position={anchor} rotation={[tilt, 0, Math.PI / 2]}>
          <mesh position={[0, 0.9, 0]} rotation={[0, 0, tilt * 0.8]} castShadow>
            <cylinderGeometry args={[0.22, 0.38, 2.0, 8]} />
            <meshStandardMaterial color="#4e7d2c" roughness={0.6} />
          </mesh>
          <mesh position={[0, -0.05, 0]} castShadow>
            <sphereGeometry args={[1.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#47752a" roughness={0.65} />
          </mesh>
          {Array.from({ length: 5 }, (_, i) => (
            <group key={i} rotation={[0, (i / 5) * Math.PI * 2, 0]}>
              <mesh position={[1.25, -0.75, 0]} rotation={[0, 0, 0.95]} scale={[0.5, 1, 0.16]} castShadow>
                <sphereGeometry args={[1.25, 10, 8]} />
                <meshStandardMaterial color="#47752a" roughness={0.65} />
              </mesh>
            </group>
          ))}
        </group>
      );
    default:
      return null;
  }
}
