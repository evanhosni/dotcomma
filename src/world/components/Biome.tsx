import React, { useContext, useLayoutEffect, useMemo } from "react";
import type { BiomeSpec } from "../types";
import { BiomeContext, RegionContext, useDomainStore } from "./context";

export interface BiomeProps extends React.PropsWithChildren {
  /** The biome as data (`<biome>/spec.ts` — flags + noise, shared with the
   *  server's domain config). Supplies name/id/flags; pass `noise` to the
   *  biome's <Terrain>. Explicit props below override it. */
  spec?: BiomeSpec;
  name?: string;
  /** Unique biome id — used by voronoi assignment and the vBiomeId shader varying. */
  id?: number;
  joinable?: boolean;
  blendable?: boolean;
  blendWidth?: number;
}

/**
 * Declares a biome inside a <Region>. Children are config components
 * (<Terrain>, <Material>, <Actor>, <Skybox>) plus always-mounted visual
 * components (e.g. <GrassField>) that gate their own placement by biome.
 */
export const Biome = ({
  spec,
  name = spec?.name,
  id = spec?.id,
  joinable = spec?.joinable ?? true,
  blendable = spec?.blendable ?? true,
  blendWidth = spec?.blendWidth,
  children,
}: BiomeProps) => {
  const store = useDomainStore("Biome");
  const region = useContext(RegionContext);
  if (!region) throw new Error("<Biome> must be mounted inside <Region>");
  if (name === undefined || id === undefined) throw new Error("<Biome> needs a `spec` or `name` + `id`");
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
