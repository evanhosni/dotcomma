import { SpawnDescriptor } from "../../objects/spawning/types";
import { Spawnable } from "../../world/components";
import { Building1 } from "./Building1";

export const Building1Descriptor: SpawnDescriptor = {
  id: "building1",
  component: Building1,
  model: "/models/building1exterior.glb",
  scale: [2, 2, 2],
  footprint: 25,
  density: 10,
  clustering: 0,
  renderDistance: 625,
  frustumPadding: 3.25,
  priority: 55,
};

/** Mounts the building1 spawn registration; props override the descriptor. */
export const Building1Spawnable = (overrides: Partial<SpawnDescriptor>) => (
  <Spawnable {...Building1Descriptor} {...overrides} />
);
