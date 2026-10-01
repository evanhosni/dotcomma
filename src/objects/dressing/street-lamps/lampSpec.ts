import type { DressingColliderPart, DressingColliderSpec } from "../types";
import { CITY_BIOME_ID } from "../../../world/constants";
import type { FreewayLampParams } from "../../../utils/workers/roads/runLamps";

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

const lampYaw = (x: number, z: number): number => Math.abs(x * 7.13 + z * 3.71) % 6.283;

/** Pole collider is a touch proud of the drawn 0.22u so its corner can't be clipped. */
export const LAMP_COLLIDER_PARTS: DressingColliderPart[] = [
  { w: 0.24, h: LAMP_POLE_HEIGHT, d: 0.24, x: 0, y: LAMP_POLE_HEIGHT / 2 },
  LAMP_PARTS.arm,
  LAMP_PARTS.head,
];

export const LAMP_PLACEMENT = {
  seedTag: "street-lamp-i",
  // High because the sidewalk band is thin; footprint spacing is the real limiter.
  density: 4200,
  footprint: 14,
  // The sidewalk band of the road field (curb 7–8, sidewalk 8–12).
  roadDistanceRange: [8.2, 11.8] as [number, number],
  biomeIds: [CITY_BIOME_ID],
};

export const STREET_LAMPS_SPEC: DressingColliderSpec<"densityPoints"> = {
  id: "StreetLamps",
  enumerator: "densityPoints",
  placement: LAMP_PLACEMENT,
  colliderParts: LAMP_COLLIDER_PARTS,
  bodiesOf: (p) => [{ x: p.x, y: p.y, z: p.z, yaw: lampYaw(p.x, p.z) }],
};

/** The inter-city runs' lamps (getFreewayRunLamps): both sides, staggered — 48u on each side, the
 *  far side offset by 24u, so along the road a head stands every 24u = the lamp-glow grid's cell
 *  (lighting/lampGlow.ts: one head per 24u texel, falloff = one cell). Each head lands in a cell of
 *  its own and the pools of light meet on the pavement; paired lamps would share a cell pair every
 *  48u and leave a dark gap between. */
export const FREEWAY_LAMP_PLACEMENT: FreewayLampParams = {
  spacing: 48,
  // 1.5u onto the grass past the shoulder paint (19u from the centerline) …
  verge: 1.5,
  // … or, where that is the grade's cut/fill ramp, on the shoulder paint (16.4u — the city lamp band's inner edge).
  shoulder: 0.4,
  endClear: 40,
  beltClear: 40,
  maxRise: 1.5,
  maxSlope: 40,
};

export const FREEWAY_LAMPS_SPEC: DressingColliderSpec<"freewayLamps"> = {
  id: "FreewayLamps",
  enumerator: "freewayLamps",
  placement: FREEWAY_LAMP_PLACEMENT,
  colliderParts: LAMP_COLLIDER_PARTS,
  bodiesOf: (p) => [{ x: p.x, y: p.y, z: p.z, yaw: p.yaw }],
};
