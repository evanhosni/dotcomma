import { useSyncExternalStore } from "react";
import type * as THREE from "three";
import { onServerMessage } from "../connection";
import type { PlayerSnapshot } from "../protocol";

/**
 * Module state mutated per frame; React only sees the ROSTER through a version
 * counter, so a move re-renders nothing. RemotePlayers.tsx drives the display
 * transform toward the last intent.
 */

export interface RemotePlayer {
  id: string;
  color: string;
  targetX: number;
  targetY: number;
  targetZ: number;
  vx: number;
  vy: number;
  vz: number;
  ry: number;
  receivedAt: number;
  /** Displayed position (eased toward the target). */
  x: number;
  y: number;
  z: number;
  displayYaw: number;
  needsInitialPlacement: boolean;
  object: THREE.Object3D | null;
}

const players = new Map<string, RemotePlayer>();
let rosterVersion = 0;
const rosterListeners = new Set<() => void>();

const bumpRoster = () => {
  rosterVersion++;
  rosterListeners.forEach((l) => l());
};

const fromSnapshot = (p: PlayerSnapshot): RemotePlayer => ({
  id: p.id,
  color: p.color,
  targetX: p.x,
  targetY: p.y,
  targetZ: p.z,
  vx: p.vx,
  vy: p.vy,
  vz: p.vz,
  ry: p.ry,
  receivedAt: performance.now(),
  x: p.x,
  y: p.y,
  z: p.z,
  displayYaw: p.ry,
  needsInitialPlacement: true,
  object: null,
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
      if (!p) break;
      p.targetX = msg.x;
      p.targetY = msg.y;
      p.targetZ = msg.z;
      p.vx = msg.vx;
      p.vy = msg.vy;
      p.vz = msg.vz;
      p.ry = msg.ry;
      p.receivedAt = performance.now();
      break;
    }
    case "leave":
      if (players.delete(msg.id)) bumpRoster();
      break;
  }
});
