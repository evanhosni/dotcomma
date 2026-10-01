import { useContext, useLayoutEffect } from "react";
import { ACTOR_COMPONENTS } from "../../objects/actors/components";
import { actorAttributesOf, mountOverridesOf, specNeedsServer, type ActorMount, type ActorSpec } from "../../objects/actors/spec";
import { ActorDescriptor, AnyActorDescriptor } from "../../objects/actors/spawning/types";
import { ActorAttributes } from "../../objects/types";
import { reportContentError } from "../../utils/contentError";
import { getActorSpec } from "../domains/configs";
import { BiomeContext, useDomainStore } from "./context";

/** A kind the server simulates must reach the server's catalog, which is derived from DOMAIN_REGIONS. */
const assertCataloged = (spec: ActorSpec): void => {
  if (!specNeedsServer(spec) || getActorSpec(spec.id) === spec) return;
  reportContentError(
    `[actors] "${spec.id}" is simulated by the server, but no domain in world/domains/configs.ts (DOMAIN_REGIONS) ` +
      `places this spec — list the domain's region list there.`,
  );
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
    reportContentError(`[actors] "${spec.id}" renders as a GLTF model but its spec sets no \`model\` (or a \`component\`).`);
  }
  // A kind the server has nothing to simulate would only register an entity for nothing.
  const localOnly = specNeedsServer(spec) ? {} : { serverSynced: false };
  const descriptor = { component, ...localOnly, ...actorAttributesOf(spec) } as unknown as AnyActorDescriptor;
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
