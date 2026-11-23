/** The player's capsule, shared by Player.tsx, RemotePlayers.tsx and the server's
 *  server/src/game/physics/bodies/PlayerBodies.ts. Published player positions are the capsule CENTER; NPC positions are FEET. */
export const PLAYER_HEIGHT = 2;
export const PLAYER_RADIUS = 0.5;
/** A player's eyes above its FEET: its beeble's (beeble.glb's eye meshes span y 1.77–1.87 at scale 1). The
 *  first-person camera is there, the third-person head aims from there, and head-tracking NPCs look there
 *  (objects/actors/state/utils.ts pitchToPlayerEyes); a beeble NPC's own eyes are there too (its body is
 *  the player's). */
export const PLAYER_EYE_HEIGHT = 1.82;

/** A player's eye height from its capsule CENTER's (published player positions are centers). */
export const playerEyeY = (centerY: number): number => centerY - PLAYER_HEIGHT / 2 + PLAYER_EYE_HEIGHT;
