import * as THREE from "three";
export enum COLLIDER_TYPE {
  CAPSULE = "capsule",
  SPHERE = "sphere",
  BOX = "box",
  TRIMESH = "trimesh",
  WHOLE_TRIMESH = "whole_trimesh",
}

// Geometry travels as TYPED-ARRAY COPIES of the GLTF buffers so both directions
// can transfer them — the originals stay with the renderer.
export interface ColliderWorkerMessage {
  type: COLLIDER_TYPE;
  positions: Float32Array;
  index: Uint32Array | null;
  matrixElements: number[]; // 16 Matrix4 elements
}

export interface WholeTrimeshWorkerMessage {
  type: COLLIDER_TYPE.WHOLE_TRIMESH;
  meshes: Array<{
    positions: Float32Array;
    index: Uint32Array | null;
    matrixElements: number[];
  }>;
}

export interface CapsuleColliderProps {
  radius: number;
  height: number;
  position: THREE.Vector3Tuple;
}

export interface SphereColliderProps {
  radius: number;
  position: THREE.Vector3Tuple;
}

export interface BoxColliderProps {
  size: THREE.Vector3Tuple;
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}

/** Already the exact array types Rapier's TrimeshCollider consumes. */
export interface TrimeshColliderProps {
  vertices: Float32Array;
  indices: Uint32Array;
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}
