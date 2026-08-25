import { ActorDescriptor } from "../spawning/types";
import { createActor } from "../../../world/components";
import { XLElement } from "./XLElement";

export const XLElementDescriptor: ActorDescriptor = {
  id: "xl-element",
  component: XLElement,
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
