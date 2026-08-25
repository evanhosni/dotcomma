import { ActorDescriptor } from "../spawning/types";
import { createActor } from "../../../world/components";
import { ModelActor, ModelActorAttributes } from "../ModelActor";

export const XXLElementDescriptor: ActorDescriptor<ModelActorAttributes> = {
  id: "xxl-element",
  component: ModelActor,
  model: "/models/apartment.glb",
  scale: [3, 3, 3],
  footprint: 80,
  density: 1,
  clustering: 0,
  renderDistance: 1000,
  frustumPadding: 4,
  priority: 5,
};

export const XXLElementActor = createActor(XXLElementDescriptor);
