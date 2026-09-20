import type { DressingColliderPart } from "../types";
import { CITY_BIOME_ID } from "../../../world/constants";

// Three-free: the art (lampGeometry.ts), the client colliders (StreetLamps.tsx) and the
// SERVER colliders (physics/obstacles.ts) are all built from these numbers.

export const LAMP_POLE_HEIGHT = 10.8;
export const LAMP_HEAD_OFFSET_X = 1.25; // head offset along the arm
export const LAMP_COLLIDER_DISTANCE = 60;

/** Post-local space, +X along the arm. */
export const LAMP_PARTS = {
  pole: { w: 0.22, h: LAMP_POLE_HEIGHT, d: 0.22, x: 0, y: LAMP_POLE_HEIGHT / 2 },
  arm: { w: 1.5, h: 0.18, d: 0.18, x: 0.65, y: LAMP_POLE_HEIGHT - 0.1 },
  head: { w: 0.85, h: 0.3, d: 0.45, x: LAMP_HEAD_OFFSET_X, y: LAMP_POLE_HEIGHT - 0.35 },
};

export const lampYaw = (x: number, z: number): number => Math.abs(x * 7.13 + z * 3.71) % 6.283;

/** Pole collider is a touch proud of the drawn 0.22u so its corner can't be clipped. */
export const LAMP_COLLIDER_PARTS: DressingColliderPart[] = [
  { w: 0.24, h: LAMP_POLE_HEIGHT, d: 0.24, x: 0, y: LAMP_POLE_HEIGHT / 2 },
  LAMP_PARTS.arm,
  LAMP_PARTS.head,
];

/** The server mirrors the city biome's mount, which uses these defaults. */
export const LAMP_PLACEMENT = {
  seedTag: "street-lamp-i",
  // High because the sidewalk band is thin; footprint spacing is the real limiter.
  density: 4200,
  footprint: 14,
  // The sidewalk band of the road field (curb 7–8, sidewalk 8–12).
  roadDistanceRange: [8.2, 11.8] as [number, number],
  biomeIds: [CITY_BIOME_ID],
};
