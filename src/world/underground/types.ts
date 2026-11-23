import * as THREE from "three";
import type { ManholeInfo, SewerDoor, TunnelEntrance, UndergroundChunk } from "../../generation/underground/types";
import type { ChunkWithPoints } from "../chunks/hooks";
import type { SelfPatchedMaterial } from "../chunks/material";

/** A type (not an interface): the dressing base's asset hook takes a record of disposables. */
export type TunnelAssets = {
  caveRock: SelfPatchedMaterial;
  sewerWall: SelfPatchedMaterial;
  object: SelfPatchedMaterial;
  sewage: SelfPatchedMaterial;
  iron: THREE.MeshStandardMaterial;
  cover: THREE.BufferGeometry;
};

export interface DoorRuntime {
  id: string;
  door: SewerDoor;
  hinge: THREE.Group;
  leaf: THREE.Mesh;
}

export interface CoverRuntime {
  id: string;
  entrance: TunnelEntrance;
  info: ManholeInfo;
  mesh: THREE.Mesh;
  /** 0 closed … 1 aside. */
  progress: number;
  target: number;
}

export interface TunnelChunkObject extends ChunkWithPoints {
  chunk: UndergroundChunk;
  group: THREE.Group;
  walls: THREE.Mesh | null;
  patch: THREE.Mesh | null;
  /** The sewers' border caps: each drawn while its neighbour chunk is not loaded (the frame loop). */
  caps: { neighbor: string; mesh: THREE.Mesh }[];
  doors: DoorRuntime[];
  /** The doors' hinges and open flags, in `doors` order: what the frame loop swings, without lists per frame. */
  doorHinges: THREE.Object3D[];
  doorsOpen: boolean[];
  covers: CoverRuntime[];
  /** The mouths whose footprint reaches this chunk. */
  mouthIds: string[];
  /** The entrance fade the walls and patch draw with (1 for a chunk with no mouth). */
  fade: number;
}
