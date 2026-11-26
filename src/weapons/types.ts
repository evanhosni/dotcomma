import type * as THREE from "three";
import type { ShotHit } from "../net/protocol/types";

/** A body a shot can hit: its id on the wire, and its posed skinned meshes (whose bones carry the wounds). */
export interface ShotTarget {
  kind: ShotHit["kind"];
  id: string;
  /** Its origin (feet or centre): the cheap test of whether the shot passes near at all. */
  origin: THREE.Vector3;
  meshes: readonly THREE.SkinnedMesh[];
}

