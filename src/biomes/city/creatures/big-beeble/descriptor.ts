import { SpawnDescriptor } from "../../../../objects/spawning/types";
import { BigBeeble } from "./BigBeeble";

export const BigBeebleDescriptor: SpawnDescriptor = {
  id: "big-beeble",
  component: BigBeeble,
  model: "/models/apartment.glb",
  footprint: 40,
  density: 8,
  clustering: 0,
  renderDistance: 750,
  frustumPadding: 3.5,
  priority: 40,
};
