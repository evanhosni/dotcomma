import type * as THREE from "three";

/** Where a unit sits on a host: the bone it screws into, the top of that bone's mesh (sunk by
 *  MAV_SEAT_SINK), and the bone-space rotation that stands the unit up out of the skull with its window
 *  facing the host's front — all at the bind pose, so the unit follows every turn of the head. */
export interface MavSeat {
  bone: THREE.Bone;
  point: THREE.Vector3;
  up: THREE.Vector3;
  rotation: THREE.Quaternion;
  /** Undoes the bone's own scale, so a unit is its own size on any host. */
  scale: number;
}
