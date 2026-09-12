import { useSyncExternalStore } from "react";
import type * as THREE from "three";
import { onServerMessage } from "../connection";
import type { PlayerSnapshot } from "../protocol";

/**
 * Remote-player STORE — the other sessions in our domain, as last reported by
 * the server, plus the smoothed DISPLAY transform the render loop drives
 * toward them. Plain module state, mutated in place every frame; React only
 * ever sees the ROSTER (who exists) through a version counter, so a join or a
 * leave re-renders the list and a move re-renders nothing.
 *
 * The hard rule from Phase 2: never snap. A remote player's display position
 * is extrapolated from its last intent (pos + v·age) and eased toward that —
 * see RemotePlayers.tsx for the per-frame math.
 */

export interface RemotePlayer {
  id: string;
  color: string;
  // ── last intent received (target) ──
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  ry: number;
  /** performance.now() when the intent arrived (extrapolation base). */
  at: number;
  // ── display state (what is actually rendered) ──
  x: number;
  y: number;
  z: number;
  dry: number;
  /** True until the first frame has placed the object (snap ONCE, at spawn). */
  fresh: boolean;
  /** The mounted Object3D this player's mesh lives in; set by the renderer. */
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
  px: p.x,
  py: p.y,
  pz: p.z,
  vx: p.vx,
  vy: p.vy,
  vz: p.vz,
  ry: p.ry,
  at: performance.now(),
  x: p.x,
  y: p.y,
  z: p.z,
  dry: p.ry,
  fresh: true,
  object: null,
});

/** Live map — iterate in the render loop, never copy per frame. */
export const getRemotePlayers = (): ReadonlyMap<string, RemotePlayer> => players;

const subscribeRoster = (l: () => void) => {
  rosterListeners.add(l);
  return () => {
    rosterListeners.delete(l);
  };
};
const getRosterVersion = () => rosterVersion;
/** Re-renders the caller on join/leave/init only. */
export const useRosterVersion = (): number => useSyncExternalStore(subscribeRoster, getRosterVersion);

// ── Wire → store ───────────────────────────────────────────────────────────

onServerMessage((msg) => {
  switch (msg.t) {
    case "init":
      // Fresh roster: a (re)connect or a domain switch. Everyone we knew is gone.
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
      p.px = msg.x;
      p.py = msg.y;
      p.pz = msg.z;
      p.vx = msg.vx;
      p.vy = msg.vy;
      p.vz = msg.vz;
      p.ry = msg.ry;
      p.at = performance.now();
      break;
    }
    case "leave":
      if (players.delete(msg.id)) bumpRoster();
      break;
  }
});
