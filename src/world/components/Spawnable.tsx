import React, { createContext, useContext, useLayoutEffect, useMemo } from "react";
import { SpawnDescriptor } from "../../objects/spawning/types";
import { BiomeContext, useWorldStore } from "./context";

const SpawnablesContext = createContext<Partial<SpawnDescriptor> | null>(null);

export interface SpawnablesProps extends React.PropsWithChildren, Partial<SpawnDescriptor> {}

/**
 * Groups a biome's spawnables. Any descriptor props set here act as shared
 * defaults for child <Spawnable>s — a child's own props always win. E.g.
 * `<Spawnables biomeIds={[CITY_BIOME_ID]}>` restricts every child to the city
 * biome unless a child sets its own `biomeIds`.
 */
export const Spawnables = ({ children, ...defaults }: SpawnablesProps) => {
  const { component, ...serializable } = defaults;
  // stable context value so parent re-renders don't churn child registrations
  const dataKey = JSON.stringify(serializable);
  const value = useMemo(() => defaults, [dataKey, component]);
  return <SpawnablesContext.Provider value={value}>{children}</SpawnablesContext.Provider>;
};

export type SpawnableProps = SpawnDescriptor;

/**
 * Registers a spawn descriptor from inside a <Biome>. Props are the full
 * SpawnDescriptor: `component`, `model`, `footprint`, `density`, plus spawn
 * restrictions (`biomeIds`, `heightRange`, `slopeRange`, spacing, priority…).
 * Defaults from an enclosing <Spawnables> fill in unset optional props.
 *
 * Note: `biomeIds` is the actual spawn-location restriction (unset = spawns
 * in every biome, matching the previous descriptor behavior); mounting inside
 * a <Biome> only namespaces the registration.
 *
 * Renders nothing — the spawn system instantiates `component` at generated
 * spawn points.
 */
export const Spawnable = (props: SpawnableProps) => {
  const store = useWorldStore("Spawnable");
  const biome = useContext(BiomeContext);
  if (!biome) throw new Error("<Spawnable> must be mounted inside <Biome>");
  const inherited = useContext(SpawnablesContext);

  // Merge <Spawnables> defaults under own props (explicit undefined doesn't
  // clobber an inherited value).
  const descriptor: SpawnDescriptor = { ...(inherited ?? {}) } as SpawnDescriptor;
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
    store.spawnables.set(key, { biomeId: biome.biomeId, descriptor });
    store.invalidate();
    return () => {
      store.spawnables.delete(key);
      store.invalidate();
    };
  }, [store, biome, component, dataKey, descriptorId]);

  return null;
};
