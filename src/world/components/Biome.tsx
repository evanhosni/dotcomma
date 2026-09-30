import React, { useContext, useLayoutEffect, useMemo } from "react";
import type { BiomeSpec } from "../types";
import { ActorMounts } from "./Actor";
import { BiomeContext, BiomeSlotContext, RegionContext, useDomainStore, useSpecSlot } from "./context";

export interface BiomeProps extends React.PropsWithChildren {
  /** The biome folder's `spec.ts`: flags, height (`noise` / `water`), blend widths and `actors` —
   *  everything the server's config reads. Children are the client-only rest (<Material>, <Dressing>…). */
  spec: BiomeSpec;
}

export const Biome = ({ spec, children }: BiomeProps) => {
  const store = useDomainStore("Biome");
  const region = useContext(RegionContext);
  if (!region) throw new Error("<Biome> must be mounted inside <Region>");
  useSpecSlot(BiomeSlotContext, spec, "Biome", "the region's <Region biomes>");
  const { regionId } = region;
  const { id } = spec;

  useLayoutEffect(() => {
    const key = `${regionId}/${id}`;
    const { name, joinable, blendWidth, heightBlendWidth, water, noise } = spec;
    const prohibitRoads = spec.prohibitRoads ?? false;
    const prohibitRivers = spec.prohibitRivers ?? false;
    store.biomes.set(key, { regionId, biome: { id, name, joinable, blendWidth, heightBlendWidth, water, prohibitRoads, prohibitRivers, noise } });
    store.invalidate();
    return () => {
      store.biomes.delete(key);
      store.invalidate();
    };
  }, [store, regionId, id, spec]);

  const ctx = useMemo(() => ({ biomeId: id, regionId }), [id, regionId]);

  return (
    <BiomeContext.Provider value={ctx}>
      {spec.actors && <ActorMounts mounts={spec.actors} />}
      {children}
    </BiomeContext.Provider>
  );
};
