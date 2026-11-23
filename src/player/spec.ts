/** The player's capsule, shared by Player.tsx, RemotePlayers.tsx and the server's
 *  server/src/game/physics/bodies/PlayerBodies.ts. Published player positions are the capsule CENTER; NPC positions are FEET. */
export const PLAYER_HEIGHT = 2;
export const PLAYER_RADIUS = 0.5;
/** A player's eyes above its capsule CENTER: where the first-person camera is (Player.tsx), and what every
 *  head-tracking NPC looks at (objects/actors/state/utils.ts pitchToPlayerEyes). */
export const PLAYER_EYE_OFFSET = PLAYER_HEIGHT / 2;
