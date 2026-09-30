import { useContext, useLayoutEffect } from "react";
import { getActorSpec } from "../../objects/actors/catalog";
import { ACTOR_COMPONENTS } from "../../objects/actors/components";
import { actorAttributesOf, mountOverridesOf, specNeedsServer, specsAgree, type ActorMount, type ActorSpec } from "../../objects/actors/spec";
import { ActorDescriptor, AnyActorDescriptor } from "../../objects/actors/spawning/types";
import { ActorAttributes } from "../../objects/types";
import { BiomeContext, useDomainStore } from "./context";

const reportActorError = (problem: string): void => {
  if (process.env.NODE_ENV === "development") throw new Error(problem);
  console.error(problem);
};

/** A kind the server simulates must be in the catalog under its id with the same simulation. */
const assertCataloged = (spec: ActorSpec): void => {
  const listed = getActorSpec(spec.id);
  const problem =
    !listed && specNeedsServer(spec)
      ? `actor "${spec.id}" has a spec the server simulates but no entry in src/objects/actors/catalog.ts. Add \`[${spec.id}]: <its spec>\` there.`
      : listed && !specsAgree(listed, spec)
        ? `actor "${spec.id}": the catalog's spec differs from the one its descriptor was built from — the client and the server would simulate different things.`
        : null;
  if (problem) reportActorError(problem);
};

const DESCRIPTOR_OF_SPEC = new WeakMap<ActorSpec, AnyActorDescriptor>();

/** The client descriptor of a spec (cached per spec): the member component the spec names
 *  (objects/actors/components.ts, default ModelActor) plus every spec attribute. */
export const describeActor = <A extends ActorAttributes>(spec: ActorSpec): ActorDescriptor<A> => {
  const cached = DESCRIPTOR_OF_SPEC.get(spec);
  if (cached) return cached as ActorDescriptor<A>;
  assertCataloged(spec);
  const component = ACTOR_COMPONENTS[spec.component ?? "model"];
  if (component === ACTOR_COMPONENTS.model && !spec.model) {
    reportActorError(`actor "${spec.id}" renders as a GLTF model but its spec sets no \`model\` (or a \`component\`).`);
  }
  const descriptor = { component, ...actorAttributesOf(spec) } as unknown as AnyActorDescriptor;
  DESCRIPTOR_OF_SPEC.set(spec, descriptor);
  return descriptor as ActorDescriptor<A>;
};

/** Registers one descriptor under the enclosing <Biome>, spawning only there: its `biomeIds` IS
 *  that biome (a kind listed by several biomes spawns in their union — mergeActorListings at the
 *  commit). Renders nothing — ActorPool instantiates `component`. */
const Actor = (props: AnyActorDescriptor) => {
  const store = useDomainStore("Actor");
  const biome = useContext(BiomeContext);
  if (!biome) throw new Error("actors must be mounted inside <Biome>");

  const descriptor: AnyActorDescriptor = { ...props, biomeIds: [biome.biomeId] };
  // A kind the server has nothing to simulate would only register an entity for nothing.
  if (descriptor.serverSynced === undefined && !getActorSpec(descriptor.id)) descriptor.serverSynced = false;

  const { component, ...serializable } = descriptor;
  const dataKey = JSON.stringify(serializable);
  const descriptorId = descriptor.id;

  useLayoutEffect(() => {
    const key = `${biome.regionId}/${biome.biomeId}/${descriptorId}`;
    store.actors.set(key, { biomeId: biome.biomeId, descriptor });
    store.invalidate();
    return () => {
      store.actors.delete(key);
      store.invalidate();
    };
  }, [store, biome, component, dataKey, descriptorId]);

  return null;
};

/** A biome spec's `actors` (rendered by <Biome>): each mount's descriptor with its overrides on top. */
export const ActorMounts = ({ mounts }: { mounts: readonly ActorMount[] }) => (
  <>
    {mounts.map((mount) => (
      <Actor key={mount.actor.id} {...describeActor(mount.actor)} {...(mountOverridesOf(mount) as Partial<AnyActorDescriptor>)} />
    ))}
  </>
);
