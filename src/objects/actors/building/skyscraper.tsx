import { createActor, describeActor } from "../../../world/components";
import { BuildingDescriptor } from "./actor";
import { SKYSCRAPER_PLACEMENT, SKYSCRAPER_SPEC } from "./spec";
import { BuildingAttributes } from "./types";

/** Skyscraper: extends BuildingDescriptor — only what differs from a normal
 *  building. The plan-shaping knobs (stories, shell height, lean, lit
 *  windows) are the spec's hull attributes, shared with the server's hull;
 *  the placement knobs are SKYSCRAPER_PLACEMENT, shared with the server's
 *  flatten pads. No wrapper component. */
export const SkyscraperDescriptor = describeActor<BuildingAttributes>(SKYSCRAPER_SPEC, {
  ...BuildingDescriptor,
  ...SKYSCRAPER_PLACEMENT,
});

export const SkyscraperActor = createActor(SkyscraperDescriptor);
