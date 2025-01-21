export enum COLLIDER_TYPE {
  CAPSULE = "capsule",
  SPHERE = "sphere",
  BOX = "box",
  CONVEX = "convex",
  TRIMESH = "trimesh",
}

export interface CapsuleColliderParams {
  geometry: any;
  position: THREE.Vector3Tuple;
  scale: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}

export interface SphereColliderParams {
  geometry: any;
  position: THREE.Vector3Tuple;
  scale: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}

export interface BoxColliderParams {
  geometry: any;
  position: THREE.Vector3Tuple;
  scale: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}

export interface TrimeshColliderParams {
  positions: number[];
  index: number[] | null;
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
  scale: THREE.Vector3Tuple;
}

export interface CapsuleColliderProps {
  radius: number;
  height: number;
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
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
