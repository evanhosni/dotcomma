import { SpawnDescriptor } from "../../../../../../objects/spawning/types";
import { Beeble } from "./Beeble";

export const BeebleDescriptor: SpawnDescriptor = {
  id: "beeble",
  component: Beeble,
  model: "/models/beeble.glb",
  footprint: 5,
  density: 40,
  clustering: 0,
  renderDistance: 500,
  frustumPadding: 3,
  priority: 80,
};
