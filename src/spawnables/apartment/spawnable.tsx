import { SpawnDescriptor } from "../../objects/spawning/types";
import { Spawnable } from "../../world/components";
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

/** Mounts the apartment spawn registration; props override the descriptor. */
export const ApartmentSpawnable = (overrides: Partial<SpawnDescriptor>) => (
  <Spawnable {...ApartmentDescriptor} {...overrides} />
);
