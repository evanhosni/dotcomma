import { ACTOR_COMPONENTS } from "../../objects/actors/components";
import { actorAttributesOf, mountOverridesOf, specNeedsServer, type ActorMount, type ActorSpec } from "../../objects/actors/spec";
import type { AnyActorDescriptor } from "../../objects/actors/spawning/types";
import { reportContentError } from "../../utils/contentError";
import { declare } from "../content";

export interface ActorProps extends ActorMount {}

/**
 * An ACTOR spawned where it is mounted: in a biome it is placed by the density field (its spec's
 * `density`/`footprint` and the biome's overrides); inside a feature (<Sewers><Rooms><Actor/>>)
 * that feature places it, one per part, and it lists separately under its own id.
 *
 * Mounting it is also what puts the kind in the SERVER's catalog (objects/actors/catalog.ts), so
 * nothing about an actor is written twice. Renders nothing — ActorPool instantiates it.
 */
export const Actor = declare<ActorProps>({ kind: "actor" });

const DESCRIPTOR_OF_SPEC = new WeakMap<ActorSpec, AnyActorDescriptor>();

/** The client descriptor of a spec (cached per spec): the member component the spec names
 *  (objects/actors/components.ts, default ModelActor) plus every spec attribute. */
export const describeActor = (spec: ActorSpec): AnyActorDescriptor => {
  const cached = DESCRIPTOR_OF_SPEC.get(spec);
  if (cached) return cached;
  const component = ACTOR_COMPONENTS[spec.component ?? "model"];
  if (component === ACTOR_COMPONENTS.model && !spec.model) {
    reportContentError(`[actors] "${spec.id}" renders as a GLTF model but its spec sets no \`model\` (or a \`component\`).`);
  }
  // A kind the server has nothing to simulate would only register an entity for nothing.
  const localOnly = specNeedsServer(spec) ? {} : { serverSynced: false };
  const descriptor = { component, ...localOnly, ...actorAttributesOf(spec) } as unknown as AnyActorDescriptor;
  DESCRIPTOR_OF_SPEC.set(spec, descriptor);
  return descriptor;
};

/** One mounted <Actor> as a spawn descriptor: the spec's attributes, the mount's overrides, the
 *  biome it stands in and — for a feature-placed one — the feature that places it. */
export const descriptorOfMount = (mount: ActorMount, id: string, biomeId: number, feature: string): AnyActorDescriptor => ({
  ...describeActor(mount.actor),
  ...(mountOverridesOf(mount) as Partial<AnyActorDescriptor>),
  id,
  biomeIds: [biomeId],
  ...(feature ? { feature } : {}),
});
