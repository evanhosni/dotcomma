import type * as THREE from "three";
import { PosePlayback } from "../entities/posePlayback";
import type { Snapshot, PuppetTarget } from "../entities/types";
import type { PlayerAvatar } from "../protocol/types";
import type { PlayerBodyState } from "../../player/types";
import type { PointXZ } from "../../utils/math/types";

/** A drawn pose as received, stamped with its move's server time. */
export interface AvatarSnapshot extends PlayerAvatar {
  st: number;
}

export interface RemotePlayer {
  id: string;
  snapshots: Snapshot[];
  playback: PosePlayback;
  /** The sampled pose (capsule CENTER); `valid` once the first sample landed. */
  pose: PuppetTarget;
  /** Where it is drawn (capsule CENTER): what local systems read (an NPC's nearest player). */
  x: number;
  y: number;
  z: number;
  /** Received drawn poses, oldest first; each is shown once the playback clock reaches its `st`. */
  avatars: AvatarSnapshot[];
  /** Its beeble (player/PlayerBody.tsx), written by RemotePlayers.tsx every frame, and the beeble's skinned
   *  meshes (filled while it is mounted): what the crosshair picks, as on an NPC. */
  body: PlayerBodyState;
  meshes: THREE.SkinnedMesh[];
  /** Where its last snow stamp was laid (RemotePlayers.tsx, objects/dressing/snow-drift/store.ts). */
  lastStamp: PointXZ;
  /** The NPC its lone MAV Unit was last shown screwing into ("" none): retired the moment it is shown as the
   *  beeble instead (RemotePlayers.tsx), so the NPC and the player's body swap in one frame. */
  shownMavHost: string;
  /** Its host died: its beeble is hidden (its corpse lies there instead) until it is shown as a MAV Unit again. */
  dead: boolean;
}
