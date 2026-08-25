import { ActorDescriptor } from "../spawning/types";
import { createActor } from "../../../world/components";
import { ModelActor, ModelActorAttributes } from "../ModelActor";

export const XLElementDescriptor: ActorDescriptor<ModelActorAttributes> = {
  id: "xl-element",
  component: ModelActor,
  model: "/models/apartment.glb",
  scale: [2, 2, 2],
  footprint: 60,
  density: 4,
  clustering: 0,
  renderDistance: 875,
  frustumPadding: 3.75,
  priority: 20,
};

export const XLElementActor = createActor(XLElementDescriptor);
