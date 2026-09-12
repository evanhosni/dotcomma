import type { CapsuleColliderSpec } from "../objects/actors/spec";

/**
 * PLAYER SPEC — the player's physical body, with no React/Three: Player.tsx
 * mounts this capsule, RemotePlayers.tsx draws other players with it, and the
 * SERVER (physics/playerBodies.ts) stands the same capsule in its world so
 * NPCs collide with players exactly as they do on the client. One source.
 *
 * The player's published position is the capsule CENTER (Player.tsx drives
 * the body by its center); NPC positions are FEET.
 */
export const PLAYER_HEIGHT = 2;
export const PLAYER_RADIUS = 0.5;

export const PLAYER_COLLIDER: CapsuleColliderSpec = {
  shape: "capsule",
  radius: PLAYER_RADIUS,
  height: PLAYER_HEIGHT,
};
