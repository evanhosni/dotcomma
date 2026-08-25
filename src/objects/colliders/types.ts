export enum COLLIDER_TYPE {
  CAPSULE = "capsule",
  SPHERE = "sphere",
  BOX = "box",
  TRIMESH = "trimesh",
  WHOLE_TRIMESH = "whole_trimesh",
}

// Worker input: all types send raw positions + a 16-element combined transform
// matrix. Geometry travels as TYPED ARRAYS (copies of the GLTF buffers — the
// originals stay with the renderer) so both directions can TRANSFER instead of
// structured-cloning tens of thousands of boxed numbers.
export interface ColliderWorkerMessage {
  type: COLLIDER_TYPE;
  positions: Float32Array;
  index: Uint32Array | null;
  matrix: number[]; // 16-element Matrix4 elements
}

// WHOLE_TRIMESH sends an array of meshes
export interface WholeTrimeshWorkerMessage {
  type: COLLIDER_TYPE.WHOLE_TRIMESH;
  meshes: Array<{
    positions: Float32Array;
    index: Uint32Array | null;
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

/** Trimesh output — already in the exact array types Rapier's
 *  TrimeshCollider consumes, so the component passes them straight through. */
export interface TrimeshColliderProps {
  vertices: Float32Array;
  indices: Uint32Array;
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}
