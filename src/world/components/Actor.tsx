import React, { createContext, useContext, useLayoutEffect, useMemo } from "react";
import { getActorSpec } from "../../objects/actors/catalog";
import { specsAgree, type ActorSpec } from "../../objects/actors/spec";
import { ActorDescriptor, AnyActorDescriptor } from "../../objects/actors/spawning/types";
import { ActorAttributes } from "../../objects/types";
import { BiomeContext, useDomainStore } from "./context";

const ActorsContext = createContext<Partial<AnyActorDescriptor> | null>(null);

export interface ActorsProps extends React.PropsWithChildren, Partial<AnyActorDescriptor> {}

/** Props set here are shared defaults for child <Actor>s — a child's own props win. */
export const Actors = ({ children, ...defaults }: ActorsProps) => {
  const { component, ...serializable } = defaults;
  const dataKey = JSON.stringify(serializable);
  const value = useMemo(() => defaults, [dataKey, component]);
  return <ActorsContext.Provider value={value}>{children}</ActorsContext.Provider>;
};

export type ActorRegistrationProps = AnyActorDescriptor;

/** Registers an actor descriptor from inside a <Biome>. `biomeIds` is the actual
 *  spawn restriction (unset = every biome); the enclosing <Biome> only namespaces
 *  the registration. Renders nothing — ActorPool instantiates `component`. */
export const Actor = (props: ActorRegistrationProps) => {
  const store = useDomainStore("Actor");
  const biome = useContext(BiomeContext);
  if (!biome) throw new Error("<Actor> must be mounted inside <Biome>");
  const inherited = useContext(ActorsContext);

  // Explicit undefined doesn't clobber an inherited value.
  const descriptor: AnyActorDescriptor = { ...(inherited ?? {}) } as AnyActorDescriptor;
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) (descriptor as any)[key] = value;
  }

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

const DESCRIPTOR_SPECS = new WeakMap<object, ActorSpec>();

/** A spec'd actor must be in the catalog under its id with the same simulation, or the server never runs it. */
const assertCataloged = (spec: ActorSpec, id: string): void => {
  const listed = getActorSpec(id);
  const problem = !listed
    ? `actor "${id}" has a spec but no entry in src/objects/actors/catalog.ts — the server can't simulate it. Add \`[${id}]: <its spec>\` there.`
    : !specsAgree(listed, spec)
      ? `actor "${id}": the catalog's spec differs from the one its descriptor was built from — the client and the server would simulate different things.`
      : null;
  if (!problem) return;
  if (process.env.NODE_ENV === "development") throw new Error(problem);
  console.error(problem);
};

/**
 * Build a descriptor from its SPEC (the Three-free half the server reads) plus
 * the client's additions. The spec's fields WIN over `attrs`. Actors the server
 * needs nothing for skip this and write a plain object.
 */
export const describeActor = <A extends ActorAttributes>(
  spec: ActorSpec,
  attrs: Omit<ActorDescriptor<A>, "id">,
): ActorDescriptor<A> => {
  assertCataloged(spec, spec.id);
  const descriptor: Record<string, unknown> = { ...attrs, ...(spec.hull ?? {}) };
  if (spec.stateMachine !== undefined) descriptor.stateMachine = spec.stateMachine;
  if (spec.body !== undefined) descriptor.body = spec.body;
  if (spec.collider !== undefined) descriptor.collider = spec.collider;
  if (spec.movement !== undefined) descriptor.movement = spec.movement;
  descriptor.id = spec.id;
  DESCRIPTOR_SPECS.set(descriptor, spec);
  return descriptor as unknown as ActorDescriptor<A>;
};

/** `<BeebleActor biomeIds={[CITY_BIOME_ID]} density={150} />` — overrides per mount.
 *  A mount that overrides `id` is checked against the catalog under the NEW id
 *  (the server keys its simulation on the wire kind). */
export const createActor =
  <A extends ActorAttributes>(descriptor: ActorDescriptor<A>) =>
  (overrides: Partial<ActorDescriptor<A>>): JSX.Element => {
    const spec = DESCRIPTOR_SPECS.get(descriptor);
    if (spec && overrides.id && overrides.id !== descriptor.id) assertCataloged(spec, overrides.id);
    return <Actor {...descriptor} {...overrides} />;
  };
