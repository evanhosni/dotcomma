import React, { createContext, useContext, useLayoutEffect, useMemo } from "react";
import { ActorDescriptor } from "../../objects/spawning/types";
import { BiomeContext, useWorldStore } from "./context";

const ActorsContext = createContext<Partial<ActorDescriptor> | null>(null);

export interface ActorsProps extends React.PropsWithChildren, Partial<ActorDescriptor> {}

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

export type ActorRegistrationProps = ActorDescriptor;

/**
 * Registers an ACTOR descriptor from inside a <Biome> — the per-object spawn
 * class (beebles, buildings: objects with their own identity, state, or
 * interaction; each mounts as its own React component through ObjectPool).
 * Props are the full ActorDescriptor: `component`, `model`, `footprint`,
 * `density`, plus spawn restrictions (`biomeIds`, `heightRange`,
 * `slopeRange`, spacing, priority…). Defaults from an enclosing <Actors>
 * fill in unset optional props.
 *
 * Note: `biomeIds` is the actual spawn-location restriction (unset = spawns
 * in every biome); mounting inside a <Biome> only namespaces the
 * registration.
 *
 * Renders nothing — the spawn system instantiates `component` at generated
 * spawn points. Mass stateless scenery should be DRESSING instead (see
 * src/dressing/) — instanced chunks, no per-object components.
 */
export const Actor = (props: ActorRegistrationProps) => {
  const store = useWorldStore("Actor");
  const biome = useContext(BiomeContext);
  if (!biome) throw new Error("<Actor> must be mounted inside <Biome>");
  const inherited = useContext(ActorsContext);

  // Merge <Actors> defaults under own props (explicit undefined doesn't
  // clobber an inherited value).
  const descriptor: ActorDescriptor = { ...(inherited ?? {}) } as ActorDescriptor;
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

/**
 * One-liner for actor definitions: builds the standard wrapper component that
 * registers `descriptor` with per-mount overrides.
 *
 *   export const BeebleActor = createActor(BeebleDescriptor);
 *   …
 *   <BeebleActor biomeIds={[CITY_BIOME_ID]} density={150} />
 */
export const createActor =
  (descriptor: ActorDescriptor) =>
  (overrides: Partial<ActorDescriptor>): JSX.Element =>
    <Actor {...descriptor} {...overrides} />;
