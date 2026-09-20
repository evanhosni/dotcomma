import { ActorDescriptor } from "../spawning/types";
import { BuildingAttributes } from "./types";
import { createActor } from "../../../world/components";
import { Building } from "./Building";

export const BuildingDescriptor: ActorDescriptor<BuildingAttributes> = {
  id: "building",
  component: Building,
  footprint: 30,
  // High on purpose: footprint spacing is the real limiter inside block
  // interiors. Halving to 1900 was tried and REVERTED — it visibly thinned the city.
  density: 3800,
  clustering: 0,
  renderDistance: 625,
  frustumPadding: 3.25,
  priority: 55,
  roadDistanceRange: [23, 99999],
  flattenGround: true,
};

/** Variants spread this descriptor and override what differs — see skyscraper.tsx. */
export const BuildingActor = createActor(BuildingDescriptor);
