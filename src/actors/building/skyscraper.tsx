import { ActorDescriptor, ActorProps } from "../../objects/spawning/types";
import { createActor } from "../../world/components";
import { BuildingDescriptor } from "./actor";
import { Building } from "./Building";

/** Skyscraper variant: max floors under a much taller shell (the mass above
 *  the top floor reads as mechanical levels), with a gentler lean so tall
 *  neighbors don't collide. Most windows light up at night — towers read as
 *  busy from across the city. */
export const Skyscraper = (props: ActorProps) => (
  <Building
    {...props}
    stories={6}
    roomCount={[3, 4, 5, 6]}
    heightRange={[70, 115]}
    maxLean={0.04}
    windowLightChance={0.8}
  />
);

/** Extends BuildingDescriptor — only what differs from a normal building. */
export const SkyscraperDescriptor: ActorDescriptor = {
  ...BuildingDescriptor,
  id: "skyscraper",
  component: Skyscraper,
  footprint: 36,
  // Restricted to deep block interiors (see roadDistanceRange), so density is
  // raised to keep the skyline as populated as before the road filter.
  density: 240,
  priority: 45,
  roadDistanceRange: [28, 99999],
};

export const SkyscraperActor = createActor(SkyscraperDescriptor);
