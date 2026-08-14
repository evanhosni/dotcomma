import { ActorDescriptor, ActorProps } from "../../spawning/types";
import { createActor } from "../../../world/components";
import { Building } from "./Building";

export const BuildingDescriptor: ActorDescriptor = {
  id: "building",
  component: Building as React.FC<ActorProps>,
  footprint: 30,
  // Buildings only place inside block interiors (off roads/sidewalks/ramps),
  // so density is set high to keep blocks packed — footprint spacing is the
  // real limiter, and the flatten engine's iterated spacing rounds convert
  // the oversupply into greedy-level packing. (Halving to 1900 was tried for
  // flatten-tile cost and REVERTED: combined with single-round spacing it
  // visibly thinned the city.)
  density: 3800,
  clustering: 0,
  renderDistance: 625,
  frustumPadding: 3.25,
  priority: 55,
  roadDistanceRange: [23, 99999],
  // Terrain flattens a pad under every building (the city rides the regional
  // base noise — without the pad, sloped block interiors clip through floors).
  flattenGround: true,
};

/** Variants (skyscraper/apartment/office/…) wrap <Building> with their own
 *  options, then EXTEND this descriptor: spread BuildingDescriptor, override
 *  id/component + whatever differs — see skyscraper.tsx. */
export const BuildingActor = createActor(BuildingDescriptor);
