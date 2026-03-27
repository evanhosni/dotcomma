export enum COLLIDER_TYPE {
  CAPSULE = "capsule",
  SPHERE = "sphere",
  BOX = "box",
  TRIMESH = "trimesh",
  WHOLE_TRIMESH = "whole_trimesh",
}

// Worker input: all types send raw positions + a 16-element combined transform matrix
export interface ColliderWorkerMessage {
  type: COLLIDER_TYPE;
  positions: number[];
  index: number[] | null;
  matrix: number[]; // 16-element Matrix4 elements
}

// WHOLE_TRIMESH sends an array of meshes
export interface WholeTrimeshWorkerMessage {
  type: COLLIDER_TYPE.WHOLE_TRIMESH;
  meshes: Array<{
    positions: number[];
    index: number[] | null;
    matrix: number[];
  }>;
}

// Worker output types
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

export interface TrimeshColliderProps {
  vertices: number[];
  indices: number[];
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}
