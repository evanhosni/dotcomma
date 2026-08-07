import { ActorDescriptor, ActorProps } from "../../objects/spawning/types";
import { createActor } from "../../world/components";
import { Building } from "./Building";

export const BuildingDescriptor: ActorDescriptor = {
  id: "building",
  component: Building as React.FC<ActorProps>,
  footprint: 30,
  // Buildings only place inside block interiors (off roads/sidewalks/ramps),
  // so density is set high to keep blocks packed — the footprint spacing is
  // the real limiter, letting buildings front right up against sidewalks.
  density: 3800,
  clustering: 0,
  renderDistance: 625,
  frustumPadding: 3.25,
  priority: 55,
  roadDistanceRange: [23, 99999],
};

/** Variants (skyscraper/apartment/office/…) wrap <Building> with their own
 *  options, then EXTEND this descriptor: spread BuildingDescriptor, override
 *  id/component + whatever differs — see skyscraper.tsx. */
export const BuildingActor = createActor(BuildingDescriptor);
