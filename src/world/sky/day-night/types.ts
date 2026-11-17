import * as THREE from "three";

// extra grid coarseness at full shrink

export interface JitterBody {
  geometry: THREE.BufferGeometry;
  /** Un-jittered local positions. */
  base: Float32Array;
  radius: number;
}
