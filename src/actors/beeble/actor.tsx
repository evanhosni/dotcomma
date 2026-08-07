import { ActorDescriptor } from "../../objects/spawning/types";
import { createActor } from "../../world/components";
import { Beeble } from "./Beeble";

export const BeebleDescriptor: ActorDescriptor = {
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

export const BeebleActor = createActor(BeebleDescriptor);
