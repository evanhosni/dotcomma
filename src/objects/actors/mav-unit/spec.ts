import { seedRand } from "../../../utils/math";
import type { RagdollImpulse } from "../state/types";

/**
 * The MAV Unit (manual anti virus): what connects a player in the real world to dotcomma. It needs an
 * organic host, so it screws into a beeble's skull (world/domains/overworld/intro/) and is worn like a hat
 * from then on (player/PlayerBody.tsx). Three-free: the server computes its impact from here.
 *
 * World units, measured from the unit's ORIGIN: the underside of its head, where the screw starts. The
 * screw points down (−y), the antenna up.
 */

/** The hexagonal head: corner radius and height. */
export const MAV_HEAD_RADIUS = 0.2;
export const MAV_HEAD_HEIGHT = 0.22;
export const MAV_SCREW_LENGTH = 0.34;
export const MAV_SCREW_RADIUS = 0.09;
export const MAV_ANTENNA_HEIGHT = 0.4;
export const MAV_BULB_RADIUS = 0.045;

/** The host bone it screws into, and how far down the top of that bone's mesh it seats when fully in: a
 *  little, so the head's underside sits in the skull's curve instead of floating on its crown. */
export const MAV_HOST_BONE = "head";
export const MAV_SEAT_SINK = 0.04;

/** The hit, as the change of velocity it gives the host's head (u/s): mostly down, a little to one side so
 *  the body topples instead of folding straight down. The side comes from the host's id, so every client and
 *  the server agree. */
const IMPACT_DOWN = 3;
const IMPACT_SIDE = 3;

export const mavImpactOf = (hostId: string): RagdollImpulse => {
  const angle = seedRand(`mav-impact|${hostId}`) * Math.PI * 2;
  return { bone: MAV_HOST_BONE, x: Math.cos(angle) * IMPACT_SIDE, y: -IMPACT_DOWN, z: Math.sin(angle) * IMPACT_SIDE };
};
