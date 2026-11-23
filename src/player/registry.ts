import type { PlayerBodyState } from "./types";

/** The mounted player bodies (PlayerBody.tsx), by the state each draws. A body has no frame loop of its own:
 *  its owner poses it from its ONE loop, right after writing its state (Player.tsx the local player's,
 *  net/players/RemotePlayers.tsx every remote one's). */
const posers = new Map<PlayerBodyState, (nowMs: number) => void>();

/** Returns the unregister. */
export const registerPlayerBody = (state: PlayerBodyState, pose: (nowMs: number) => void): (() => void) => {
  posers.set(state, pose);
  return () => {
    if (posers.get(state) === pose) posers.delete(state);
  };
};

/** Poses the body drawing `state` (nothing until it has mounted: its model loads first). */
export const posePlayerBody = (state: PlayerBodyState, nowMs: number): void => posers.get(state)?.(nowMs);
