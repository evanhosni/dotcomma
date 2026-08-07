import { ActorDescriptor } from "../../objects/spawning/types";
import { createActor } from "../../world/components";
import { Building1 } from "./Building1";

export const Building1Descriptor: ActorDescriptor = {
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

export const Building1Actor = createActor(Building1Descriptor);
