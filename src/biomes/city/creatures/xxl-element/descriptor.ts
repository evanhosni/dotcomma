import { SpawnDescriptor } from "../../../../objects/spawning/types";
import { XXLElement } from "./XXLElement";

export const XXLElementDescriptor: SpawnDescriptor = {
  id: "xxl-element",
  component: XXLElement,
  model: "/models/apartment.glb",
  footprint: 80,
  density: 1,
  clustering: 0,
  renderDistance: 1000,
  frustumPadding: 4,
  priority: 5,
};
