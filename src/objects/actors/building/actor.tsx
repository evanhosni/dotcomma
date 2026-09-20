import { createActor, describeActor } from "../../../world/components";
import { Building } from "./Building";
import { BUILDING_PLACEMENT, BUILDING_SPEC } from "./spec";
import { BuildingAttributes } from "./types";

export const BuildingDescriptor = describeActor<BuildingAttributes>(BUILDING_SPEC, {
  component: Building,
  renderDistance: 625,
  frustumPadding: 3.25,
  ...BUILDING_PLACEMENT,
});

/** Variants spread this descriptor into describeActor with their own spec — see skyscraper.tsx. */
export const BuildingActor = createActor(BuildingDescriptor);
