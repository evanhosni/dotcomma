import React, { useContext, useLayoutEffect, useMemo } from "react";
import type { BiomeSpec } from "../types";
import { BiomeContext, RegionContext, useDomainStore } from "./context";

export interface BiomeProps extends React.PropsWithChildren {
  /** `<biome>/spec.ts` (flags + noise, shared with the server). Explicit props override it. */
  spec?: BiomeSpec;
  name?: string;
  id?: number;
  joinable?: boolean;
  blendable?: boolean;
  blendWidth?: number;
}

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
