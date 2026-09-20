import { useContext, useLayoutEffect } from "react";
import { TerrainParams } from "../types";
import { BiomeNoiseConfig } from "../types";
import { BiomeContext, RegionContext, RegionTerrainConfig, useDomainStore } from "./context";

export interface TerrainConfigProps extends Partial<TerrainParams> {
  /** Biome scope: the biome's ONLY height definition. */
  noise?: BiomeNoiseConfig;
}

/** Scope-aware: under <Domain> = global TerrainParams (unset → defaults),
 *  under <Region> = reserved, under <Biome> = the height definition (`noise`). */
export const Terrain = (props: TerrainConfigProps) => {
  const store = useDomainStore("Terrain");
  const biome = useContext(BiomeContext);
  const region = useContext(RegionContext);

  const { noise, ...domainParams } = props;
  // Stringified deps: inline JSX literals must not re-commit the world per parent render.
  const noiseKey = JSON.stringify(noise ?? null);
  const domainKey = JSON.stringify(domainParams);

  useLayoutEffect(() => {
    if (biome) {
      const key = `${biome.regionId}/${biome.biomeId}`;
      store.biomeTerrain.set(key, { biomeId: biome.biomeId, config: { noise } });
      store.invalidate();
      return () => {
        store.biomeTerrain.delete(key);
        store.invalidate();
      };
    }
    if (region) {
      store.regionTerrain.set(region.regionId, domainParams as RegionTerrainConfig);
      store.invalidate();
      return () => {
        store.regionTerrain.delete(region.regionId);
        store.invalidate();
      };
    }
    store.domainTerrain = domainParams;
    store.invalidate();
    return () => {
      store.domainTerrain = null;
      store.invalidate();
    };
  }, [store, biome, region, noiseKey, domainKey]);

  return null;
};
