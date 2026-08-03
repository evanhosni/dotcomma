import { SpawnDescriptor } from "../../objects/spawning/types";
import { Spawnable } from "../../world/components";
import { XXLElement } from "./XXLElement";

export const XXLElementDescriptor: SpawnDescriptor = {
  id: "xxl-element",
  component: XXLElement,
  model: "/models/apartment.glb",
  scale: [3, 3, 3],
  footprint: 80,
  density: 1,
  clustering: 0,
  renderDistance: 1000,
  frustumPadding: 4,
  priority: 5,
};

/** Mounts the xxl-element spawn registration; props override the descriptor. */
export const XXLElementSpawnable = (overrides: Partial<SpawnDescriptor>) => (
  <Spawnable {...XXLElementDescriptor} {...overrides} />
);
