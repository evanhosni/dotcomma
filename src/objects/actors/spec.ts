import type { StateMachineConfig } from "./state/types";
import type { BuildingAttributes } from "./building/types";

/**
 * ACTOR SPEC — the Three-free, React-free half of an actor definition: what
 * the SERVER must know to simulate it. One object per actor kind, in the
 * actor's own folder (`<actor>/spec.ts`), listed once in `./catalog.ts`.
 *
 *   - `stateMachine`  the behavior. Synced instances run it on the server (the
 *                     one authority); `serverSynced={false}` instances run it
 *                     locally. Same file either way.
 *   - `body` / `collider` / `movement`
 *                     how it exists physically. "kinematic" + "ground": a
 *                     walker on the shared character resolver (terrain,
 *                     buildings, poles, players); "kinematic" + "free": a
 *                     flyer/swimmer integrating its velocity with no gravity
 *                     and no ground; "fixed": colliders from the model, never
 *                     moves; "none": no colliders.
 *   - `hull`          procedural BUILDINGS: the plan-shaping attributes the
 *                     server generates the sealed convex hull collider from.
 *
 * The client descriptor is built FROM the spec (`describeActor(spec, …)` in
 * world/components/Actor.tsx), so the two can never disagree about a kind.
 * Actors the server needs nothing for (a static model with no behavior) have
 * no spec at all — their descriptor is a plain object.
 */

export interface CapsuleColliderSpec {
  shape: "capsule";
  radius: number;
  /** Total height, feet to top. */
  height: number;
}
export type ColliderSpec = CapsuleColliderSpec;

export type BodyKind = "none" | "fixed" | "kinematic";
export type MovementKind = "ground" | "free";

export interface ActorSpec {
  /** The descriptor id — also the entity `kind` on the wire. */
  id: string;
  stateMachine?: StateMachineConfig;
  body?: BodyKind;
  /** Kinematic body shape (default capsule r0.5 h2). */
  collider?: ColliderSpec;
  /** Kinematic: "ground" (default) or "free". */
  movement?: MovementKind;
  /** Building kinds: the attributes the hull is generated from. */
  hull?: BuildingAttributes;
}

export const DEFAULT_COLLIDER: CapsuleColliderSpec = { shape: "capsule", radius: 0.5, height: 2 };

/** Do two specs describe the same simulation? (The catalog guard compares the
 *  descriptor's spec against the catalog's entry for its id.) */
export const specsAgree = (a: ActorSpec, b: ActorSpec): boolean =>
  a.stateMachine === b.stateMachine &&
  (a.body ?? "fixed") === (b.body ?? "fixed") &&
  (a.movement ?? "ground") === (b.movement ?? "ground") &&
  (a.collider?.radius ?? DEFAULT_COLLIDER.radius) === (b.collider?.radius ?? DEFAULT_COLLIDER.radius) &&
  (a.collider?.height ?? DEFAULT_COLLIDER.height) === (b.collider?.height ?? DEFAULT_COLLIDER.height) &&
  JSON.stringify(a.hull ?? null) === JSON.stringify(b.hull ?? null);

/** True when the server has anything to do for this kind. */
export const specNeedsServer = (s: ActorSpec): boolean =>
  s.stateMachine !== undefined || s.body === "kinematic" || s.hull !== undefined;
