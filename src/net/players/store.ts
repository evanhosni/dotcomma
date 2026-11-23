/**
 * Module state mutated per frame; React only sees the ROSTER through a version
 * counter, so a move re-renders nothing. Each player's moves are a server-stamped
 * snapshot track, played back by the entities' sampler (RemotePlayers.tsx).
 */
import { useSyncExternalStore } from "react";
import { onServerMessage } from "..";
import { PosePlayback } from "../entities/posePlayback";
import { pushSnapshot } from "../entities/utils";
import type { Snapshot } from "../entities/types";
import type { PlayerSnapshot, ServerMoveMessage } from "../protocol/types";
import { PLAYER_HEIGHT } from "../../player/spec";
import type { AvatarSnapshot, RemotePlayer } from "./types";

/** Received poses kept per player: a clock that stops advancing (a hidden tab) must not grow it forever. */
const MAX_AVATAR_QUEUE = 32;

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

const avatarOf = (m: PlayerSnapshot | ServerMoveMessage): AvatarSnapshot => ({ st: m.st, hy: m.hy, hp: m.hp, clip: m.clip, cs: m.cs, loop: m.loop });

const fromSnapshot = (p: PlayerSnapshot): RemotePlayer => ({
  id: p.id,
  color: p.color,
  snapshots: [snapshotOf(p)],
  playback: new PosePlayback(),
  pose: { valid: false, x: p.x, y: p.y, z: p.z, ry: p.ry, vx: 0, vy: 0, vz: 0 },
  x: p.x,
  y: p.y,
  z: p.z,
  avatars: [avatarOf(p)],
  meshes: [],
  body: { feetX: p.x, feetY: p.y - PLAYER_HEIGHT / 2, feetZ: p.z, yaw: p.ry, headYaw: p.hy, headPitch: p.hp, clip: p.clip, clipSpeed: p.cs, loop: p.loop, visible: false },
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
      if (!p) break;
      pushSnapshot(p.snapshots, snapshotOf(msg));
      p.avatars.push(avatarOf(msg));
      if (p.avatars.length > MAX_AVATAR_QUEUE) p.avatars.shift();
      break;
    }
    case "leave":
      if (players.delete(msg.id)) bumpRoster();
      break;
    case "player:clicked":
      console.log("you were clicked");
      break;
  }
});
