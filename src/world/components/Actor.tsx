import React, { createContext, useContext, useLayoutEffect, useMemo } from "react";
import { ActorAttributes } from "../../objects/types";
import { ActorDescriptor, AnyActorDescriptor } from "../../objects/actors/spawning/types";
import { BiomeContext, useDomainStore } from "./context";

const ActorsContext = createContext<Partial<AnyActorDescriptor> | null>(null);

export interface ActorsProps extends React.PropsWithChildren, Partial<AnyActorDescriptor> {}

/** Props set here are shared defaults for child <Actor>s; a child's own props win. */
export const Actors = ({ children, ...defaults }: ActorsProps) => {
  const { component, ...serializable } = defaults;
  const dataKey = JSON.stringify(serializable);
  const value = useMemo(() => defaults, [dataKey, component]);
  return <ActorsContext.Provider value={value}>{children}</ActorsContext.Provider>;
};

export type ActorRegistrationProps = AnyActorDescriptor;

/** Registers an ActorDescriptor. `biomeIds` is the actual spawn restriction
 *  (unset = every biome); the enclosing <Biome> only namespaces the registration. */
export const Actor = (props: ActorRegistrationProps) => {
  const store = useDomainStore("Actor");
  const biome = useContext(BiomeContext);
  if (!biome) throw new Error("<Actor> must be mounted inside <Biome>");
  const inherited = useContext(ActorsContext);

  // An explicit undefined must not clobber an inherited default.
  const descriptor: AnyActorDescriptor = { ...(inherited ?? {}) } as AnyActorDescriptor;
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) (descriptor as any)[key] = value;
  }

  const { component, ...serializable } = descriptor;
  // Stringified deps: inline descriptor objects must not re-register per parent render.
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

/** `export const BeebleActor = createActor(BeebleDescriptor)` → `<BeebleActor density={150} />` (props override). */
export const createActor =
  <A extends ActorAttributes>(descriptor: ActorDescriptor<A>) =>
  (overrides: Partial<ActorDescriptor<A>>): JSX.Element =>
    <Actor {...descriptor} {...overrides} />;
