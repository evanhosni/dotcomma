import { createActor } from "../../../world/components";
import { ActorDescriptor } from "../spawning/types";
import { BuildingDescriptor } from "./actor";
import { BuildingAttributes } from "./types";
import { SKYSCRAPER_ATTRS } from "./variants";

/** Skyscraper: extends BuildingDescriptor — only what differs from a normal
 *  building. Max floors under a much taller shell (the mass above the top
 *  floor reads as mechanical levels), a gentler lean so tall neighbors don't
 *  collide, and most windows lit at night so towers read as busy from across
 *  the city. Every knob here is a BuildingAttributes field forwarded to the
 *  <Building> instance — no wrapper component. */
export const SkyscraperDescriptor: ActorDescriptor<BuildingAttributes> = {
  ...BuildingDescriptor,
  id: "skyscraper",
  footprint: 36,
  // Restricted to deep block interiors (see roadDistanceRange), so density is
  // raised to keep the skyline as populated as before the road filter.
  density: 240,
  priority: 45,
  roadDistanceRange: [28, 99999],
  // flattenGround inherited from BuildingDescriptor — skyscrapers get their
  // own (larger, footprint-derived) pad via the flattenRadius default.
  // The plan-shaping knobs live in variants.ts (shared with the server's hull).
  ...SKYSCRAPER_ATTRS,
};

export const SkyscraperActor = createActor(SkyscraperDescriptor);
