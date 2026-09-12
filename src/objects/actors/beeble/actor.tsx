import { createActor, describeActor } from "../../../world/components";
import { ModelActor, ModelActorAttributes } from "../ModelActor";
import { BEEBLE_SPEC } from "./spec";

/**
 * The beeble NPC. Its behavior (stateMachine.ts) and body (spec.ts) come from
 * the spec — the same object the server simulates; everything here is the
 * client's half: the model and how it spawns. No component of its own:
 * ModelActor wires the state machine, the mouse events, the capsule and the
 * animation for every actor whose spec has a `stateMachine`.
 */
export const BeebleDescriptor = describeActor<ModelActorAttributes>(BEEBLE_SPEC, {
  component: ModelActor,
  model: "/models/beeble.glb",
  scale: [1.2, 1.2, 1.2],
  isStatic: false,
  footprint: 5,
  density: 200,
  clustering: 0,
  renderDistance: 200,
  frustumPadding: 3,
  priority: 80,
});

export const BeebleActor = createActor(BeebleDescriptor);
