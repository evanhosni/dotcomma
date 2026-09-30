import { BRIDGES_SPEC } from "./bridges/bridgeSpec";
import { POWER_LINES_SPEC } from "./power-lines/poleSpec";
import { STREET_LAMPS_SPEC } from "./street-lamps/lampSpec";
import { TRAFFIC_LIGHTS_SPEC } from "./traffic-lights/signalSpec";
import type { DressingColliderSpec } from "./types";

/** Every dressing feature with colliders — the ONE list the server's obstacles.ts builds from (the
 *  dressing twin of actors/catalog.ts). A solid feature = its Three-free `*Spec.ts` + one line here.
 *  Order = the server's body order per chunk. */
export const DRESSING_COLLIDER_SPECS: readonly DressingColliderSpec[] = [
  BRIDGES_SPEC,
  STREET_LAMPS_SPEC,
  TRAFFIC_LIGHTS_SPEC,
  POWER_LINES_SPEC,
];
