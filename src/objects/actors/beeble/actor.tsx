import { ActorDescriptor } from "../spawning/types";
import { createActor } from "../../../world/components";
import { Beeble } from "./Beeble";
import { ModelActorAttributes } from "../ModelActor";

export const BeebleDescriptor: ActorDescriptor<ModelActorAttributes> = {
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
