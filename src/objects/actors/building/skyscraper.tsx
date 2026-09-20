import { createActor, describeActor } from "../../../world/components";
import { BuildingDescriptor } from "./actor";
import { SKYSCRAPER_PLACEMENT, SKYSCRAPER_SPEC } from "./spec";
import { BuildingAttributes } from "./types";

export const SkyscraperDescriptor = describeActor<BuildingAttributes>(SKYSCRAPER_SPEC, {
  ...BuildingDescriptor,
  ...SKYSCRAPER_PLACEMENT,
});

export const SkyscraperActor = createActor(SkyscraperDescriptor);
