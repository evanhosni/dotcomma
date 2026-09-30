import type { ActorAttributes } from "../types";
import { BUILDING_HULL_KEYS } from "./building/spec";
import type { BuildingAttributes } from "./building/types";
import type { StateMachineConfig } from "./state/types";

/**
 * The Three-free, React-free definition of an actor kind — one per kind in
 * `<actor>/spec.ts`. The SERVER reads the simulation half (machine, body, hull,
 * interact reach) through ./catalog.ts; the client builds its descriptor from the
 * whole thing (describeActor), and biome specs place it (`BiomeSpec.actors`), so
 * nothing about an actor is written twice.
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

/** Which client member renders the kind (objects/actors/components.ts). */
export type ActorComponentName = "model" | "building";

/** A GLTF actor's own knobs (ModelActor). */
export interface ModelAttributes {
  /** Public-URL GLTF path. */
  model: string;
  scale?: [number, number, number];
  /** Default true; movers pass false. */
  collidersNeverMove?: boolean;
  /** One trimesh over the whole model instead of per-node colliders. */
  wholeTrimesh?: boolean;
  excludeColliderNames?: string[];
}

/** What the server simulates. */
export interface ActorSimulationAttributes {
  /** Synced instances run it on the server and mirror its state here; local ones run it here. */
  stateMachine?: StateMachineConfig;
  body?: BodyKind;
  /** Kinematic body shape (default DEFAULT_COLLIDER). */
  collider?: ColliderSpec;
  /** Default "ground". */
  movement?: MovementKind;
  /** Farthest ray distance a player can hover/click it from. Default DEFAULT_INTERACT_REACH. */
  interactReach?: number;
}

/** An actor's biomes are the biomes that list it (`BiomeSpec.actors`), never a field: neither a spec
 *  nor a mount can name `biomeIds` (actorPlacementsOf derives them). */
type ListedActorAttributes = Omit<ActorAttributes, "biomeIds">;

export interface ActorSpec extends ListedActorAttributes, Partial<ModelAttributes>, ActorSimulationAttributes {
  /** The descriptor id — also the entity `kind` on the wire. Unique across every actor. */
  id: string;
  /** Default "model" (needs `model`). */
  component?: ActorComponentName;
  /** Buildings: the attributes the plan (and the server's sealed hull) is generated from. */
  hull?: BuildingAttributes;
}

/** One actor placed in a biome (`BiomeSpec.actors`): the kind plus this biome's overrides. It spawns
 *  ONLY in the biomes that list it — a kind for several biomes is listed in each. A mount never
 *  renames the kind — a second placement with different settings is a second spec. */
export interface ActorMount extends ListedActorAttributes, Partial<Omit<ModelAttributes & BuildingAttributes, "biomeIds">> {
  actor: ActorSpec;
}

export const DEFAULT_COLLIDER: CapsuleColliderSpec = { shape: "capsule", radius: 0.5, height: 2 };

export const DEFAULT_INTERACT_REACH = 5;
/** The server measures reach 2D from the player's last REPORTED position to the actor's origin, so it
 *  allows this much more than the client's ray distance (report lag, eye height, model radius). */
export const INTERACT_REACH_SLACK = 3;
export const serverInteractReachSq = (spec: ActorSpec | undefined): number =>
  ((spec?.interactReach ?? DEFAULT_INTERACT_REACH) + INTERACT_REACH_SLACK) ** 2;

export const specsAgree = (a: ActorSpec, b: ActorSpec): boolean =>
  a.stateMachine === b.stateMachine &&
  (a.body ?? "fixed") === (b.body ?? "fixed") &&
  (a.movement ?? "ground") === (b.movement ?? "ground") &&
  (a.collider?.radius ?? DEFAULT_COLLIDER.radius) === (b.collider?.radius ?? DEFAULT_COLLIDER.radius) &&
  (a.collider?.height ?? DEFAULT_COLLIDER.height) === (b.collider?.height ?? DEFAULT_COLLIDER.height) &&
  (a.interactReach ?? DEFAULT_INTERACT_REACH) === (b.interactReach ?? DEFAULT_INTERACT_REACH) &&
  JSON.stringify(a.hull ?? null) === JSON.stringify(b.hull ?? null);

export const specNeedsServer = (s: ActorSpec): boolean =>
  s.stateMachine !== undefined || s.body === "kinematic" || s.hull !== undefined;

/** A spec's attributes as one flat object: its fields, the hull's generation attributes spread in
 *  (they are the building's props), no `component` name. */
export const actorAttributesOf = (spec: ActorSpec): Record<string, unknown> => {
  const { component, hull, ...fields } = spec;
  return { ...fields, ...(hull ?? {}) };
};

const warnedHullOverrides = new Set<string>();

/** A mount's overrides (everything but `actor`). In dev, warns once per kind when one overrides a
 *  hull attribute: the server builds the sealed hull from the SPEC's hull, so the two would differ. */
export const mountOverridesOf = (mount: ActorMount): Record<string, unknown> => {
  const { actor, ...overrides } = mount;
  if (process.env.NODE_ENV !== "production" && actor.hull && !warnedHullOverrides.has(actor.id)) {
    const hullKeys = Object.keys(overrides).filter((k) => (BUILDING_HULL_KEYS as readonly string[]).includes(k));
    if (hullKeys.length > 0) {
      warnedHullOverrides.add(actor.id);
      console.warn(
        `[actors] a mount of "${actor.id}" overrides hull attribute(s) ${hullKeys.join(", ")} — the server generates the ` +
          `sealed hull from the spec's \`hull\`, so its collider would not match. Make a variant spec instead (building/spec.ts).`,
      );
    }
  }
  return overrides;
};

/** What a mount places: the spec's attributes with the mount's overrides on top. */
export const mountAttributesOf = (mount: ActorMount): Record<string, unknown> => ({
  ...actorAttributesOf(mount.actor),
  ...mountOverridesOf(mount),
});

/** One placement per kind from its biome listings (in listing order, each listing's `biomeIds` =
 *  its own biome): the kind spawns in the UNION of the biomes that list it, every other attribute
 *  from its last listing. The client commit (collectDescriptors, buildDomainConfig) and the specs'
 *  config (domainConfig.ts) both go through this, so the flatten pads and the spawn worker agree. */
export const mergeActorListings = <T extends { id: string; biomeIds?: number[] }>(listings: Iterable<T>): T[] => {
  const byId = new Map<string, T>();
  for (const listing of listings) {
    const prev = byId.get(listing.id);
    const biomeIds = prev ? [...new Set([...(prev.biomeIds ?? []), ...(listing.biomeIds ?? [])])] : listing.biomeIds;
    byId.set(listing.id, { ...listing, biomeIds });
  }
  return Array.from(byId.values());
};
