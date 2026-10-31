import { useSyncExternalStore } from "react";
import type * as THREE from "three";
import { onServerMessage } from "../connection";
import { PosePlayback } from "../entities/posePlayback";
import { pushSnapshot, type Snapshot } from "../entities/interpolation";
import type { PuppetTarget } from "../entities/useSyncedEntity";
import type { PlayerSnapshot, ServerMoveMessage } from "../protocol";
import type { PointXZ } from "../../utils/math/types";

/**
 * Module state mutated per frame; React only sees the ROSTER through a version
 * counter, so a move re-renders nothing. Each player's moves are a server-stamped
 * snapshot track, played back by the entities' sampler (RemotePlayers.tsx).
 */

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
  /** Where its last snow stamp was laid (RemotePlayers.tsx, snow-drift/trail.ts). */
  lastStamp: PointXZ;
}

const players = new Map<string, RemotePlayer>();
let rosterVersion = 0;
const rosterListeners = new Set<() => void>();

const bumpRoster = () => {
  rosterVersion++;
  rosterListeners.forEach((l) => l());
};

const snapshotOf = (m: PlayerSnapshot | ServerMoveMessage): Snapshot => ({
  st: m.st,
  x: m.x,
  y: m.y,
  z: m.z,
  ry: m.ry,
  vx: m.vx,
  vy: m.vy,
  vz: m.vz,
});

const fromSnapshot = (p: PlayerSnapshot): RemotePlayer => ({
  id: p.id,
  color: p.color,
  snapshots: [snapshotOf(p)],
  playback: new PosePlayback(),
  pose: { valid: false, x: p.x, y: p.y, z: p.z, ry: p.ry, vx: 0, vy: 0, vz: 0 },
  x: p.x,
  y: p.y,
  z: p.z,
  displayYaw: p.ry,
  object: null,
  lastStamp: { x: Infinity, z: Infinity },
});

/** The live map — iterate it, never copy per frame. */
export const getRemotePlayers = (): ReadonlyMap<string, RemotePlayer> => players;

const subscribeRoster = (l: () => void) => {
  rosterListeners.add(l);
  return () => {
    rosterListeners.delete(l);
  };
};
const getRosterVersion = () => rosterVersion;
export const useRosterVersion = (): number => useSyncExternalStore(subscribeRoster, getRosterVersion);

onServerMessage((msg) => {
  switch (msg.t) {
    case "init":
      players.clear();
      for (const p of msg.players) players.set(p.id, fromSnapshot(p));
      bumpRoster();
      break;
    case "join":
      players.set(msg.player.id, fromSnapshot(msg.player));
      bumpRoster();
      break;
    case "move": {
      const p = players.get(msg.id);
      if (p) pushSnapshot(p.snapshots, snapshotOf(msg));
      break;
    }
    case "leave":
      if (players.delete(msg.id)) bumpRoster();
      break;
  }
});
