import type { StateMachineConfig } from "./state/types";
import type { BuildingAttributes } from "./building/types";

/**
 * The Three-free, React-free half of an actor definition — what the SERVER must
 * know to simulate it. One per actor kind in `<actor>/spec.ts`, listed once in
 * ./catalog.ts; the client descriptor is built FROM it (describeActor), so the
 * two can never disagree. Actors the server needs nothing for have no spec.
 */

export interface CapsuleColliderSpec {
  shape: "capsule";
  radius: number;
  /** Feet to top. */
  height: number;
}
export type ColliderSpec = CapsuleColliderSpec;

/** "fixed": colliders from the model, never moves; "kinematic": a moving body; "none": no colliders. */
export type BodyKind = "none" | "fixed" | "kinematic";
/** "ground": the shared character resolver (gravity, slopes); "free": integrates its velocity, no gravity. */
export type MovementKind = "ground" | "free";

export interface ActorSpec {
  /** The descriptor id — also the entity `kind` on the wire. */
  id: string;
  stateMachine?: StateMachineConfig;
  body?: BodyKind;
  /** Kinematic body shape (default capsule r0.5 h2). */
  collider?: ColliderSpec;
  /** Default "ground". */
  movement?: MovementKind;
  /** Buildings: the attributes the server generates the sealed hull from. */
  hull?: BuildingAttributes;
}

export const DEFAULT_COLLIDER: CapsuleColliderSpec = { shape: "capsule", radius: 0.5, height: 2 };

export const specsAgree = (a: ActorSpec, b: ActorSpec): boolean =>
  a.stateMachine === b.stateMachine &&
  (a.body ?? "fixed") === (b.body ?? "fixed") &&
  (a.movement ?? "ground") === (b.movement ?? "ground") &&
  (a.collider?.radius ?? DEFAULT_COLLIDER.radius) === (b.collider?.radius ?? DEFAULT_COLLIDER.radius) &&
  (a.collider?.height ?? DEFAULT_COLLIDER.height) === (b.collider?.height ?? DEFAULT_COLLIDER.height) &&
  JSON.stringify(a.hull ?? null) === JSON.stringify(b.hull ?? null);

export const specNeedsServer = (s: ActorSpec): boolean =>
  s.stateMachine !== undefined || s.body === "kinematic" || s.hull !== undefined;
