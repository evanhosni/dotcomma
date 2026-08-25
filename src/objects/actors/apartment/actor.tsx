import { ActorDescriptor } from "../spawning/types";
import { createActor } from "../../../world/components";
import { Apartment } from "./Apartment";

export const ApartmentDescriptor: ActorDescriptor = {
  id: "apartment",
  component: Apartment,
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
