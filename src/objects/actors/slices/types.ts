import type * as THREE from "three";

/** One skinned mesh as a slice reads it (geometry.ts sliceMesh). */
export interface SliceInput {
  /** Indexed. A sliced one carries its flesh triangles after `userData.fleshStart`. */
  geometry: THREE.BufferGeometry;
  /** Mesh space → the bind space the cut planes are in (skinning's `bindMatrix`). */
  bindMatrix: THREE.Matrix4;
  /** The skeleton's bone names, by skin index. */
  boneNames: readonly string[];
  /** Each vertex's WELD: one id per point of the surface, its seam copies sharing it. Two pieces a cut
   *  parted never share one again, however close their vertices lie. */
  weld: Int32Array;
}

/** A cap's middle: where a stump bleeds from. */
export interface Stump {
  vertex: number;
  /** Out of the stump (mesh space, unit). */
  normal: THREE.Vector3;
}

export interface SliceResult {
  /** Group 0 the skin (the mesh's own material), group 1 the flesh (caps over every cut). */
  geometry: THREE.BufferGeometry;
  weld: Int32Array;
  /** Each vertex's PIECE (0..pieceCount-1): what the cut parted, each part of the surface it crossed
   *  connected through the welds. -1: an island the cut never crossed (an eye, a piece parted before). */
  piece: Int32Array;
  pieceCount: number;
  stumps: Stump[];
}
