import type { ActorSpec, CapsuleColliderSpec } from "../spec";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "../../../player/spec";
import { ASCEND_CLIP, HEAD_TURN_LAYER } from "./animations";
import { BEEBLE_SM } from "./stateMachine";

/** The player's capsule: the player IS a beeble (player/PlayerBody.tsx), so every beeble is its size. */
const BEEBLE_COLLIDER: CapsuleColliderSpec = {
  shape: "capsule",
  radius: PLAYER_RADIUS,
  height: PLAYER_HEIGHT,
};

/** The template NPC: behavior + body (what the server simulates) and its model and spawn knobs. */
export const BEEBLE_SPEC: ActorSpec = {
  id: "beeble",
  stateMachine: BEEBLE_SM,
  animation: { frameRate: 15, procedural: [ASCEND_CLIP], layers: [HEAD_TURN_LAYER] },
  motion: { rotationStep: 45 },
  body: "kinematic",
  collider: BEEBLE_COLLIDER,
  movement: "ground",
  model: "/models/beeble.glb",
  footprint: 5,
  density: 200,
  clustering: 0,
  renderDistance: 200,
  frustumPadding: 3,
  priority: 80,
};
