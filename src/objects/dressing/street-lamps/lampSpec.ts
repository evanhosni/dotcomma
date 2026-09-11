import type { DressingColliderPart } from "../types";
import { CITY_BIOME_ID } from "../../../world/constants";

/**
 * STREET LAMP SPEC — the numbers, with no Three: part boxes, the deterministic
 * yaw, the collider parts and the placement defaults. lampGeometry.ts builds
 * the art from LAMP_PARTS, StreetLamps.tsx mounts LAMP_COLLIDER_PARTS and
 * places with LAMP_PLACEMENT, and the SERVER (physics/obstacles.ts) builds the
 * identical colliders from the identical placement — one source, so the art,
 * the client colliders and the server colliders cannot drift apart.
 */

export const LAMP_POLE_HEIGHT = 10.8;
export const LAMP_ARM_X = 1.25; // lamp head offset along the arm
export const LAMP_COLLIDER_DISTANCE = 60;

/** The lamp's parts as boxes, in POST-LOCAL space (+X along the arm). */
export const LAMP_PARTS = {
  pole: { w: 0.22, h: LAMP_POLE_HEIGHT, d: 0.22, x: 0, y: LAMP_POLE_HEIGHT / 2 },
  arm: { w: 1.5, h: 0.18, d: 0.18, x: 0.65, y: LAMP_POLE_HEIGHT - 0.1 },
  head: { w: 0.85, h: 0.3, d: 0.45, x: LAMP_ARM_X, y: LAMP_POLE_HEIGHT - 0.35 },
};

/** Deterministic yaw from a lamp's position, so a lamp faces the same way on
 *  every load (and every chunk rebuild) — and on the server. */
export const lampYaw = (x: number, z: number): number => Math.abs(x * 7.13 + z * 3.71) % 6.283;

/** Pole (a touch proud of the drawn 0.22u so its corner can't be clipped),
 *  arm and head — box sizes from LAMP_PARTS, the same numbers the geometry is
 *  built from. */
export const LAMP_COLLIDER_PARTS: DressingColliderPart[] = [
  { w: 0.24, h: LAMP_POLE_HEIGHT, d: 0.24, x: 0, y: LAMP_POLE_HEIGHT / 2 },
  LAMP_PARTS.arm,
  LAMP_PARTS.head,
];

/** Default density placement (StreetLamps props override per mount — the
 *  server mirrors the CITY biome's mount, which uses these defaults). */
export const LAMP_PLACEMENT = {
  seedTag: "street-lamp-i",
  // Lamps per 1,000,000 sq units of CANDIDATE area — the sidewalk band is
  // thin, so this is high; footprint spacing is the real limiter.
  density: 4200,
  // Min spacing between lamps along a sidewalk.
  footprint: 14,
  // Road-field band lamps may stand on (default: the sidewalk).
  roadDistanceRange: [8.2, 11.8] as [number, number],
  // The city — the only biome with the road field lamps place by.
  biomeIds: [CITY_BIOME_ID],
};
