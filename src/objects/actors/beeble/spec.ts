import type { ActorSpec, CapsuleColliderSpec } from "../spec";
import { BEEBLE_SM } from "./stateMachine";

/**
 * BEEBLE SPEC — everything the server needs to simulate a beeble, with no
 * React/Three: its behavior and its body. The client descriptor (actor.tsx)
 * is built from this object; the server reads it through ../catalog.ts.
 */
export const BEEBLE_COLLIDER: CapsuleColliderSpec = {
  shape: "capsule",
  radius: 0.5,
  height: 2.4,
};

export const BEEBLE_SPEC: ActorSpec = {
  id: "beeble",
  stateMachine: BEEBLE_SM,
  // A walker: the shared character resolver owns gravity and slopes; the
  // state machine only supplies a velocity and a facing.
  body: "kinematic",
  collider: BEEBLE_COLLIDER,
  movement: "ground",
};
