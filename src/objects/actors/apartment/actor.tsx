import { ActorDescriptor } from "../spawning/types";
import { createActor } from "../../../world/components";
import { ModelActor, ModelActorAttributes } from "../ModelActor";

export const ApartmentDescriptor: ActorDescriptor<ModelActorAttributes> = {
  id: "apartment",
  component: ModelActor,
  wholeTrimesh: true,
  model: "/models/apartment.glb",
  scale: [1, 1, 1],
  footprint: 25,
  density: 15,
  clustering: 0,
  renderDistance: 625,
  frustumPadding: 3.25,
  priority: 60,
};

export const ApartmentActor = createActor(ApartmentDescriptor);
