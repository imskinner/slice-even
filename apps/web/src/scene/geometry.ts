import * as THREE from "three";
import { splitMesh, type Mesh, type Plane, type SplitPiece } from "@slice-even/core";

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

/**
 * Visual split with flat caps. The skin keeps `skin`; the cut faces get
 * `flesh` (two material groups, so a piece can be split again: "thirds"
 * rounds).
 *
 * This is only for rendering. The score comes from core's sliceVolumes, which
 * does not need caps.
 */
export function splitGeometry(geometry: THREE.BufferGeometry, plane: Plane, skin: THREE.Material, flesh: THREE.Material): Halves {
  const positions = geometry.getAttribute("position").array;
  const indices = geometry.getIndex()!.array;
  // A piece of an earlier split remembers where its own cut faces begin.
  const capStart = (geometry.userData.capStart as number | undefined) ?? indices.length / 3;
  const { front, back } = splitMesh(positions, indices, plane, capStart);
  return { front: pieceMesh(front, skin, flesh), back: pieceMesh(back, skin, flesh) };
}

function pieceMesh(piece: SplitPiece, skin: THREE.Material, flesh: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(piece.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(piece.indices, 1));
  geometry.addGroup(0, piece.capStart * 3, 0);
  geometry.addGroup(piece.capStart * 3, piece.indices.length - piece.capStart * 3, 1);
  // Cap vertices are separate from the skin's, so the skin stays smooth and the cut face flat.
  geometry.computeVertexNormals();
  geometry.userData.capStart = piece.capStart;
  if (piece.indices.length > 0) geometry.computeBoundingBox();
  // Nothing on this side (the knife missed): an empty box at the origin rather than an infinite one.
  else geometry.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
  return new THREE.Mesh(geometry, [skin, flesh]);
}
