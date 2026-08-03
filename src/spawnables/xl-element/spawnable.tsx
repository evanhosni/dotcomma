import { SpawnDescriptor } from "../../objects/spawning/types";
import { Spawnable } from "../../world/components";
import { XLElement } from "./XLElement";

export const XLElementDescriptor: SpawnDescriptor = {
  id: "xl-element",
  component: XLElement,
  model: "/models/apartment.glb",
  scale: [2, 2, 2],
  footprint: 60,
  density: 4,
  clustering: 0,
  renderDistance: 875,
  frustumPadding: 3.75,
  priority: 20,
};

/** Mounts the xl-element spawn registration; props override the descriptor. */
export const XLElementSpawnable = (overrides: Partial<SpawnDescriptor>) => (
  <Spawnable {...XLElementDescriptor} {...overrides} />
);
