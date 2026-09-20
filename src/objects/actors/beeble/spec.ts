import type { ActorSpec, CapsuleColliderSpec } from "../spec";
import { BEEBLE_SM } from "./stateMachine";

export const BEEBLE_COLLIDER: CapsuleColliderSpec = {
  shape: "capsule",
  radius: 0.5,
  height: 2.4,
};

export const BEEBLE_SPEC: ActorSpec = {
  id: "beeble",
  stateMachine: BEEBLE_SM,
  body: "kinematic",
  collider: BEEBLE_COLLIDER,
  movement: "ground",
};
