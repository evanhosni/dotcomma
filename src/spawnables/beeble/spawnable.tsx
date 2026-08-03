import { SpawnDescriptor } from "../../objects/spawning/types";
import { Spawnable } from "../../world/components";
import { Beeble } from "./Beeble";

export const BeebleDescriptor: SpawnDescriptor = {
  id: "beeble",
  component: Beeble,
  model: "/models/beeble.glb",
  footprint: 5,
  density: 200,
  clustering: 0,
  renderDistance: 200,
  frustumPadding: 3,
  priority: 80,
};

/** Mounts the beeble spawn registration; props override the descriptor. */
export const BeebleSpawnable = (overrides: Partial<SpawnDescriptor>) => (
  <Spawnable {...BeebleDescriptor} {...overrides} />
);
