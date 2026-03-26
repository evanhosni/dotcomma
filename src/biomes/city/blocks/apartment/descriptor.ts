import { SpawnDescriptor } from "../../../../objects/spawning/types";
import { Apartment } from "./Apartment";

export const ApartmentDescriptor: SpawnDescriptor = {
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
