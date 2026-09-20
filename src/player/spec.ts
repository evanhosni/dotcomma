import type { CapsuleColliderSpec } from "../objects/actors/spec";

/** The player's capsule, shared by Player.tsx, RemotePlayers.tsx and the server's
 *  playerBodies.ts. Published player positions are the capsule CENTER; NPC positions are FEET. */
export const PLAYER_HEIGHT = 2;
export const PLAYER_RADIUS = 0.5;

export const PLAYER_COLLIDER: CapsuleColliderSpec = {
  shape: "capsule",
  radius: PLAYER_RADIUS,
  height: PLAYER_HEIGHT,
};
