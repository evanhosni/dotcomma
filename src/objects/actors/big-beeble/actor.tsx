import { ActorDescriptor } from "../spawning/types";
import { createActor } from "../../../world/components";
import { BigBeeble } from "./BigBeeble";

export const BigBeebleDescriptor: ActorDescriptor = {
  id: "big-beeble",
  component: BigBeeble,
  model: "/models/apartment.glb",
  scale: [1.5, 1.5, 1.5],
  footprint: 40,
  density: 8,
  clustering: 0,
  renderDistance: 750,
  frustumPadding: 3.5,
  priority: 40,
};

export const BigBeebleActor = createActor(BigBeebleDescriptor);
