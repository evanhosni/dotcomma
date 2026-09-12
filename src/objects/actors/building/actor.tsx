import { createActor, describeActor } from "../../../world/components";
import { Building } from "./Building";
import { BUILDING_PLACEMENT, BUILDING_SPEC } from "./spec";
import { BuildingAttributes } from "./types";

/**
 * The procedural building. Shape comes from the spec's hull attributes (the
 * server builds its sealed collider from the same plan); placement from
 * BUILDING_PLACEMENT (shared with the server's domain config, which
 * replicates the flatten pads under every building).
 */
export const BuildingDescriptor = describeActor<BuildingAttributes>(BUILDING_SPEC, {
  component: Building,
  renderDistance: 625,
  frustumPadding: 3.25,
  ...BUILDING_PLACEMENT,
});

/** Variants (skyscraper/apartment/office/…) EXTEND this descriptor: spread
 *  BuildingDescriptor into describeActor with their own spec and whatever
 *  differs — see skyscraper.tsx. */
export const BuildingActor = createActor(BuildingDescriptor);
