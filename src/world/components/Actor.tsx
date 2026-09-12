import React, { createContext, useContext, useLayoutEffect, useMemo } from "react";
import { getActorSpec } from "../../objects/actors/catalog";
import { specsAgree, type ActorSpec } from "../../objects/actors/spec";
import { ActorDescriptor, AnyActorDescriptor } from "../../objects/actors/spawning/types";
import { ActorAttributes } from "../../objects/types";
import { BiomeContext, useDomainStore } from "./context";

const ActorsContext = createContext<Partial<AnyActorDescriptor> | null>(null);

export interface ActorsProps extends React.PropsWithChildren, Partial<AnyActorDescriptor> {}

/**
 * Groups a biome's actors. Any descriptor props set here act as shared
 * defaults for child <Actor>s — a child's own props always win. E.g.
 * `<Actors biomeIds={[CITY_BIOME_ID]}>` restricts every child to the city
 * biome unless a child sets its own `biomeIds`.
 */
export const Actors = ({ children, ...defaults }: ActorsProps) => {
  const { component, ...serializable } = defaults;
  // stable context value so parent re-renders don't churn child registrations
  const dataKey = JSON.stringify(serializable);
  const value = useMemo(() => defaults, [dataKey, component]);
  return <ActorsContext.Provider value={value}>{children}</ActorsContext.Provider>;
};

export type ActorRegistrationProps = AnyActorDescriptor;

/**
 * Registers an ACTOR descriptor from inside a <Biome> — the per-object spawn
 * class (beebles, buildings: objects with their own identity, state, or
 * interaction; each mounts as its own React component through ActorPool).
 * Props are the full ActorDescriptor: `component`, `footprint`, `density`,
 * the member's own attributes (`model`, `stories`, …), plus spawn restrictions (`biomeIds`, `heightRange`,
 * `slopeRange`, spacing, priority…). Defaults from an enclosing <Actors>
 * fill in unset optional props.
 *
 * Note: `biomeIds` is the actual spawn-location restriction (unset = spawns
 * in every biome); mounting inside a <Biome> only namespaces the
 * registration.
 *
 * Renders nothing — the spawn system instantiates `component` at generated
 * spawn points. Mass stateless scenery should be DRESSING instead (see
 * objects/dressing/) — instanced chunks, no per-object components.
 */
export const Actor = (props: ActorRegistrationProps) => {
  const store = useDomainStore("Actor");
  const biome = useContext(BiomeContext);
  if (!biome) throw new Error("<Actor> must be mounted inside <Biome>");
  const inherited = useContext(ActorsContext);

  // Merge <Actors> defaults under own props (explicit undefined doesn't
  // clobber an inherited value).
  const descriptor: AnyActorDescriptor = { ...(inherited ?? {}) } as AnyActorDescriptor;
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) (descriptor as any)[key] = value;
  }

  const { component, ...serializable } = descriptor;
  // Registered under stringified deps so inline descriptor objects don't
  // re-register on every parent render.
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

// ── Defining actors ─────────────────────────────────────────────────────────

/** Descriptor → the spec it was described from (a side table, never a prop). */
const DESCRIPTOR_SPECS = new WeakMap<object, ActorSpec>();

/** A spec'd actor must be in the catalog under its id, with the same
 *  simulation — otherwise the server never runs it. Loud in dev. */
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
 * Build an actor DESCRIPTOR from its SPEC (objects/actors/spec.ts — the
 * Three-free half the server also reads) plus everything the client adds:
 * the component, the model, spawn density/footprint/radius, render tuning.
 *
 *   export const BeebleDescriptor = describeActor<ModelActorAttributes>(BEEBLE_SPEC, {
 *     component: ModelActor, model: "/models/beeble.glb", footprint: 5, density: 200, …
 *   });
 *
 * The spec's fields WIN over `attrs` (a building's hull attributes shape the
 * client's plan exactly as they shape the server's hull), and the spec must
 * be listed in the catalog under its id (checked here, at module load).
 * Actors the server needs nothing for skip this and write a plain object.
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

/**
 * One-liner for actor definitions: builds the standard wrapper component that
 * registers `descriptor` with per-mount overrides.
 *
 *   export const BeebleActor = createActor(BeebleDescriptor);
 *   …
 *   <BeebleActor biomeIds={[CITY_BIOME_ID]} density={150} />
 *
 * A mount that overrides `id` (the grass biomes' `<BuildingActor
 * id="grass-building">` — descriptors dedupe by id) is checked against the
 * catalog under the NEW id: the server keys its simulation on the wire kind.
 */
export const createActor =
  <A extends ActorAttributes>(descriptor: ActorDescriptor<A>) =>
  (overrides: Partial<ActorDescriptor<A>>): JSX.Element => {
    const spec = DESCRIPTOR_SPECS.get(descriptor);
    if (spec && overrides.id && overrides.id !== descriptor.id) assertCataloged(spec, overrides.id);
    return <Actor {...descriptor} {...overrides} />;
  };
