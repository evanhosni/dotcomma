import { createActor } from "../../../world/components";
import { ActorDescriptor } from "../spawning/types";
import { BuildingDescriptor } from "./actor";
import { BuildingAttributes } from "./types";
import { SKYSCRAPER_ATTRS } from "./variants";

export const SkyscraperDescriptor: ActorDescriptor<BuildingAttributes> = {
  ...BuildingDescriptor,
  id: "skyscraper",
  footprint: 36,
  density: 240,
  priority: 45,
  roadDistanceRange: [28, 99999],
  ...SKYSCRAPER_ATTRS,
};

export const SkyscraperActor = createActor(SkyscraperDescriptor);
