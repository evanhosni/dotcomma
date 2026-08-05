import { useContext, useLayoutEffect } from "react";
import { WorldTerrainParams } from "../registry";
import { BiomeNoiseConfig } from "../types";
import { BiomeContext, RegionContext, RegionTerrainConfig, useWorldStore } from "./context";

export interface TerrainConfigProps extends Partial<WorldTerrainParams> {
  /** Biome scope: the biome's height definition. Single source of truth —
   *  evaluated by the shared pipeline (workers/vertexCompute.ts) on both the
   *  workers and the main thread. */
  noise?: BiomeNoiseConfig;
}

/**
 * Scope-aware terrain rules. Where it's mounted decides what it configures:
 *
 * - Inside <World>:  global terrain params (seed, grid sizes, boundary/river
 *   widths, base/road noise, city config). Unset props fall back to
 *   DEFAULT_WORLD_TERRAIN_PARAMS.
 * - Inside <Region>: reserved — stored for future per-region terrain rules.
 * - Inside <Biome>:  the biome's height definition (`noise`), consumed by the
 *   shared vertex pipeline everywhere heights are computed.
 *
 * Renders nothing — pure registration.
 */
export const Terrain = (props: TerrainConfigProps) => {
  const store = useWorldStore("Terrain");
  const biome = useContext(BiomeContext);
  const region = useContext(RegionContext);

  const { noise, ...worldParams } = props;
  // Object props are registered under stringified deps so inline literals in
  // JSX don't re-register (and re-commit the world) on every parent render.
  const noiseKey = JSON.stringify(noise ?? null);
  const worldKey = JSON.stringify(worldParams);

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
      store.regionTerrain.set(region.regionId, worldParams as RegionTerrainConfig);
      store.invalidate();
      return () => {
        store.regionTerrain.delete(region.regionId);
        store.invalidate();
      };
    }
    store.worldTerrain = worldParams;
    store.invalidate();
    return () => {
      store.worldTerrain = null;
      store.invalidate();
    };
  }, [store, biome, region, noiseKey, worldKey]);

  return null;
};
