import React, { useContext, useLayoutEffect, useMemo } from "react";
import { BiomeContext, RegionContext, useDomainStore } from "./context";

export interface BiomeProps extends React.PropsWithChildren {
  name: string;
  /** Unique biome id — used by voronoi assignment and the vBiomeId shader varying. */
  id: number;
  joinable?: boolean;
  blendable?: boolean;
  blendWidth?: number;
}

/**
 * Declares a biome inside a <Region>. Children are config components
 * (<Terrain>, <Material>, <Actor>, <Skybox>) plus always-mounted visual
 * components (e.g. <GrassField>) that gate their own placement by biome.
 */
export const Biome = ({ name, id, joinable = true, blendable = true, blendWidth, children }: BiomeProps) => {
  const store = useDomainStore("Biome");
  const region = useContext(RegionContext);
  if (!region) throw new Error("<Biome> must be mounted inside <Region>");
  const regionId = region.regionId;

  useLayoutEffect(() => {
    const key = `${regionId}/${id}`;
    store.biomes.set(key, { regionId, biome: { id, name, joinable, blendable, blendWidth } });
    store.invalidate();
    return () => {
      store.biomes.delete(key);
      store.invalidate();
    };
  }, [store, regionId, id, name, joinable, blendable, blendWidth]);

  const ctx = useMemo(() => ({ biomeId: id, regionId }), [id, regionId]);

  return <BiomeContext.Provider value={ctx}>{children}</BiomeContext.Provider>;
};
