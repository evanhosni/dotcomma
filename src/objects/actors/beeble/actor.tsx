import { ActorDescriptor } from "../spawning/types";
import { createActor } from "../../../world/components";
import { Beeble } from "./Beeble";
import { ModelActorAttributes } from "../ModelActor";

export const BeebleDescriptor: ActorDescriptor<ModelActorAttributes> = {
  id: "beeble",
  component: Beeble,
  model: "/models/beeble.glb",
  // A walker: ModelActor owns the capsule, gravity and slopes; the state
  // machine only supplies a velocity (see kinematicMover.tsx).
  body: "kinematic",
  collider: { shape: "capsule", radius: 0.5, height: 2.4 },
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
