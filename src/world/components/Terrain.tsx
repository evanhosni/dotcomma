import { useContext, useLayoutEffect } from "react";
import { TerrainParams } from "../types";
import { BiomeNoiseConfig } from "../types";
import { BiomeContext, RegionContext, RegionTerrainConfig, useDomainStore } from "./context";

export interface TerrainConfigProps extends Partial<TerrainParams> {
  /** Biome scope: the biome's height definition. Single source of truth —
   *  evaluated by the shared pipeline (utils/workers/vertexCompute.ts) on both the
   *  workers and the main thread. */
  noise?: BiomeNoiseConfig;
}

/**
 * Scope-aware terrain rules. Where it's mounted decides what it configures:
 *
 * - Inside <Domain>:  global terrain params (seed, grid sizes, boundary/river
 *   widths, base/road noise, city config). Unset props fall back to
 *   DEFAULT_TERRAIN_PARAMS.
 * - Inside <Region>: reserved — stored for future per-region terrain rules.
 * - Inside <Biome>:  the biome's height definition (`noise`), consumed by the
 *   shared vertex pipeline everywhere heights are computed.
 *
 * Renders nothing — pure registration.
 */
export const Terrain = (props: TerrainConfigProps) => {
  const store = useDomainStore("Terrain");
  const biome = useContext(BiomeContext);
  const region = useContext(RegionContext);

  const { noise, ...domainParams } = props;
  // Object props are registered under stringified deps so inline literals in
  // JSX don't re-register (and re-commit the world) on every parent render.
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
