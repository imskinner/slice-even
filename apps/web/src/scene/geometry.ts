import * as THREE from "three";
import { Brush, Evaluator, INTERSECTION, SUBTRACTION } from "three-bvh-csg";
import type { Mesh, Plane } from "@slice-even/core";

export function toBufferGeometry(mesh: Mesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

export interface Halves {
  /** Side the plane normal points to. */
  front: THREE.Mesh;
  back: THREE.Mesh;
}

const evaluator = new Evaluator();
evaluator.attributes = ["position", "normal"];
evaluator.useGroups = true;

/**
 * Visual split with flat caps, via CSG against a big box whose face lies on
 * the plane. The skin keeps `skin`; the cut face gets `flesh`.
 *
 * This is only for rendering. The score comes from core's sliceVolumes, which
 * does not need caps.
 */
export function splitGeometry(
  geometry: THREE.BufferGeometry,
  plane: Plane,
  skin: THREE.Material,
  flesh: THREE.Material,
): Halves {
  const n = new THREE.Vector3(...plane.normal).normalize();
  const size = 100;
  const box = new Brush(new THREE.BoxGeometry(size, size, size), flesh);
  // Box's local +X face goes on the plane, the box itself on the front side.
  box.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), n);
  box.position.set(...plane.point).addScaledVector(n, size / 2);
  box.updateMatrixWorld();

  const object = new Brush(geometry, skin);
  object.updateMatrixWorld();

  const [front, back] = evaluator.evaluate(object, box, [INTERSECTION, SUBTRACTION], [new Brush(), new Brush()]);
  return { front: front!, back: back! };
}
