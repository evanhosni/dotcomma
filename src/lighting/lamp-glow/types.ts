import * as THREE from "three";

/** Recolor through setLampHeadColor, which marks the grid dirty. */
export interface LampHead {
  position: THREE.Vector3;
  color: number;
}
