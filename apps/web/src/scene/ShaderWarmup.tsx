import { useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { generateObject, OBJECT_KINDS, type ObjectKind } from "@slice-even/core";
import { createMaterials } from "./materials.ts";

/**
 * Compiling one of the procedural shaders takes a few hundred milliseconds,
 * and three.js does it on the spot the first time something is drawn with
 * it: a frozen frame every time a new kind of object appeared, and another
 * at its first cut. Worse, a program is thrown away as soon as the last
 * material using it is disposed, so the same shaders were compiled again
 * round after round.
 *
 * This keeps one material of every kind (skin and cut face) and of the few
 * plain ones the scene uses, for as long as the canvas lives. They are
 * compiled in the background, without blocking a frame where the browser
 * supports it, and because they are never disposed the programs stay around
 * for the real objects to share.
 */
export function ShaderWarmup({
  onKindReady,
  parallel = 1,
}: {
  /** Called once a kind's skin and cut-face programs are ready to draw. */
  onKindReady?(kind: ObjectKind): void;
  /** How many compilations to keep going at once. */
  parallel?: number;
}) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    let stopped = false;
    const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const materials: THREE.Material[] = [];
    const jobs: { object: THREE.Object3D; kind?: ObjectKind }[] = [];
    const add = (list: THREE.Material[], kind?: ObjectKind, instanced = false) => {
      const group = new THREE.Group();
      for (const material of list) {
        const mesh = instanced ? new THREE.InstancedMesh(geometry, material, 1) : new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        materials.push(material);
      }
      jobs.push({ object: group, kind });
    };

    for (const kind of OBJECT_KINDS) {
      // The program depends on the kind, not on the particular object or its color.
      const { skin, flesh } = createMaterials(generateObject(kind, "warm", "preview"), "#b3261e");
      add([skin, flesh], kind);
    }
    // The plain variants used by the knife, the balance, the cloche, the marks on the board and the splash.
    add([
      new THREE.MeshStandardMaterial(),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5 }),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    ]);
    add([new THREE.MeshPhysicalMaterial({ clearcoat: 1 })], undefined, true);

    let next = 0;
    const run = async () => {
      while (!stopped && next < jobs.length) {
        const job = jobs[next++]!;
        try {
          await gl.compileAsync(job.object, camera, scene);
        } catch {
          // A shader that fails here fails the same way when drawn; nothing to add.
        }
        if (!stopped && job.kind) onKindReady?.(job.kind);
      }
    };
    for (let i = 0; i < parallel; i++) void run();

    return () => {
      stopped = true;
      geometry.dispose();
      for (const material of materials) material.dispose();
    };
    // Once per canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera]);

  return null;
}
