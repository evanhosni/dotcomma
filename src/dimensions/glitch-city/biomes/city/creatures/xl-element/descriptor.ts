import { SpawnDescriptor } from "../../../../../../objects/spawning/types";
import { XLElement } from "./XLElement";

export const XLElementDescriptor: SpawnDescriptor = {
  id: "xl-element",
  component: XLElement,
  model: "/models/apartment.glb",
  footprint: 60,
  density: 4,
  clustering: 0,
  renderDistance: 875,
  frustumPadding: 3.75,
  priority: 20,
};
