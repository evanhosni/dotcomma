import { ActorDescriptor } from "../spawning/types";
import { createActor } from "../../../world/components";
import { Beeble } from "./Beeble";
import { ModelActorAttributes } from "../ModelActor";
import { BEEBLE_COLLIDER } from "./spec";

export const BeebleDescriptor: ActorDescriptor<ModelActorAttributes> = {
  id: "beeble",
  component: Beeble,
  model: "/models/beeble.glb",
  // A walker: ModelActor owns the capsule, gravity and slopes; the state
  // machine only supplies a velocity (see kinematicMover.tsx).
  body: "kinematic",
  collider: BEEBLE_COLLIDER, // spec.ts — shared with the server (kinds.ts)
  movement: "ground",
  isStatic: false,
  footprint: 5,
  density: 200,
  clustering: 0,
  renderDistance: 200,
  frustumPadding: 3,
  priority: 80,
};

export const BeebleActor = createActor(BeebleDescriptor);
