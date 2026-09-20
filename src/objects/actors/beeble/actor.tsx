import { createActor, describeActor } from "../../../world/components";
import { ModelActor, ModelActorAttributes } from "../ModelActor";
import { BEEBLE_SPEC } from "./spec";

/** Behavior and body come from the spec (the server simulates the same object); this is the client's half. */
export const BeebleDescriptor = describeActor<ModelActorAttributes>(BEEBLE_SPEC, {
  component: ModelActor,
  model: "/models/beeble.glb",
  scale: [1.2, 1.2, 1.2],
  collidersNeverMove: false,
  footprint: 5,
  density: 200,
  clustering: 0,
  renderDistance: 200,
  frustumPadding: 3,
  priority: 80,
});

export const BeebleActor = createActor(BeebleDescriptor);
