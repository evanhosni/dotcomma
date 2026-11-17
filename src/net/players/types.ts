import type * as THREE from "three";
import { PosePlayback } from "../entities/posePlayback";
import type { Snapshot, PuppetTarget } from "../entities/types";
import type { PointXZ } from "../../utils/math/types";

export interface RemotePlayer {
  id: string;
  color: string;
  snapshots: Snapshot[];
  playback: PosePlayback;
  /** The sampled pose (capsule CENTER); `valid` once the first sample landed. */
  pose: PuppetTarget;
  /** Where it is drawn (capsule CENTER): what local systems read (an NPC's nearest player). */
  x: number;
  y: number;
  z: number;
  /** Displayed facing, eased toward the sampled one. */
  displayYaw: number;
  object: THREE.Object3D | null;
  /** Where its last snow stamp was laid (RemotePlayers.tsx, objects/dressing/snow-drift/store.ts). */
  lastStamp: PointXZ;
}
