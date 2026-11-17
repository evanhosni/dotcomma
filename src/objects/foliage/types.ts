import * as THREE from "three";

export interface Heading {
  /** Unit direction of travel; 0 when standing or just teleported. */
  x: number;
  z: number;
  anchorX: number;
  anchorZ: number;
}

export interface FoliageChunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh | null; // null = built but empty
  total: number; // blades the chunk places in full — instanceCount is a distance fraction of it
  held: number; // blades uploaded: the first `held` of the fade-key order
  band: number;
  lowDetail: boolean;
}

/** A chunk to request: new, or (`widen`) a held chunk's wider band. */
export interface SweepCandidate {
  key: number;
  cx: number;
  cz: number;
  distSq: number;
  band: number;
  widen: boolean;
}
