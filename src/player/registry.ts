import type * as THREE from "three";
import type { PlayerBodyState } from "./types";

/** The mounted player bodies (PlayerBody.tsx), by the state each draws. A body has no frame loop of its own:
 *  its owner poses it from its ONE loop, right after writing its state (Player.tsx the local player's,
 *  net/players/RemotePlayers.tsx every remote one's). */
const posers = new Map<PlayerBodyState, (nowMs: number) => void>();
/** Each mounted body's model (its clone's root, under the group that stands it): a corpse copies its pose. */
const models = new Map<PlayerBodyState, THREE.Object3D>();

/** Returns the unregister. */
export const registerPlayerBody = (state: PlayerBodyState, pose: (nowMs: number) => void, model: THREE.Object3D): (() => void) => {
  posers.set(state, pose);
  models.set(state, model);
  return () => {
    if (posers.get(state) !== pose) return;
    posers.delete(state);
    models.delete(state);
  };
};

export const playerBodyModel = (state: PlayerBodyState): THREE.Object3D | undefined => models.get(state);

/** Poses the body drawing `state` (nothing until it has mounted: its model loads first). */
export const posePlayerBody = (state: PlayerBodyState, nowMs: number): void => posers.get(state)?.(nowMs);
