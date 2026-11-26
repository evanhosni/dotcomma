import type { PlayerForm } from "../net/protocol/types";

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

/** How noticeable a player of each form is to NPCs, 0 (never) to 1 (fully). A lone MAV Unit is never noticed:
 *  NPCs see only the beeble it has become. Every machine's "nearest player" skips a player at 0, on the
 *  server and on each client's mirror alike; the levels between are left for stealth. */
export const PLAYER_DETECTABILITY: Readonly<Record<PlayerForm, number>> = { mav: 0, host: 1 };

/** A lone MAV Unit is also no obstacle: no capsule, here or on the server. */
export const isPlayerSolid = (form: PlayerForm): boolean => form === "host";

/** A placed capsule starts this far over its feet's ground, never inside it (Player.tsx). */
export const SPAWN_CLEARANCE = 0.05;

/** A player's host's health when it takes it over (weapons/spec.ts damage). */
export const PLAYER_HEALTH = 100;
