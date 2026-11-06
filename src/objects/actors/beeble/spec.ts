import type { ActorSpec, CapsuleColliderSpec } from "../spec";
import { ASCEND_CLIP, HEAD_TURN_LAYER } from "./animations";
import { BEEBLE_SM } from "./stateMachine";

const BEEBLE_COLLIDER: CapsuleColliderSpec = {
  shape: "capsule",
  radius: 0.5,
  height: 2.4,
};

/** The template NPC: behavior + body (what the server simulates) and its model and spawn knobs. */
export const BEEBLE_SPEC: ActorSpec = {
  id: "beeble",
  stateMachine: BEEBLE_SM,
  animation: { frameRate: 10, procedural: [ASCEND_CLIP], layers: [HEAD_TURN_LAYER] },
  motion: { rotationStep: 45 },
  body: "kinematic",
  collider: BEEBLE_COLLIDER,
  movement: "ground",
  model: "/models/beeble.glb",
  scale: [1.2, 1.2, 1.2],
  footprint: 5,
  density: 200,
  clustering: 0,
  renderDistance: 200,
  frustumPadding: 3,
  priority: 80,
};
