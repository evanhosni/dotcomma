import { useContext, useLayoutEffect } from "react";
import { WorldTerrainParams } from "../registry";
import { BiomeNoiseConfig, VertexData } from "../types";
import { BiomeContext, RegionContext, RegionTerrainConfig, useWorldStore } from "./context";

export interface TerrainConfigProps extends Partial<WorldTerrainParams> {
  /** Biome scope: main-thread height function (Player raycasts, world getVertexData). */
  getVertexData?: (vertexData: VertexData) => Promise<VertexData>;
  /** Biome scope: worker-side height noise, sent to terrain/spawn/grass workers. */
  noise?: BiomeNoiseConfig;
}

/**
 * Scope-aware terrain rules. Where it's mounted decides what it configures:
 *
 * - Inside <World>:  global terrain params (seed, grid sizes, boundary/river
 *   widths, base/road noise, city config). Unset props fall back to
 *   DEFAULT_WORLD_TERRAIN_PARAMS.
 * - Inside <Region>: reserved — stored for future per-region terrain rules.
 * - Inside <Biome>:  the biome's height pipeline (`getVertexData` for the
 *   main thread, `noise` for the workers).
 *
 * Renders nothing — pure registration.
 */
export const Terrain = (props: TerrainConfigProps) => {
  const store = useWorldStore("Terrain");
  const biome = useContext(BiomeContext);
  const region = useContext(RegionContext);

  const { getVertexData, noise, ...worldParams } = props;
  // Object props are registered under stringified deps so inline literals in
  // JSX don't re-register (and re-commit the world) on every parent render.
  const noiseKey = JSON.stringify(noise ?? null);
  const worldKey = JSON.stringify(worldParams);

  useLayoutEffect(() => {
    if (biome) {
      const key = `${biome.regionId}/${biome.biomeId}`;
      store.biomeTerrain.set(key, { biomeId: biome.biomeId, config: { getVertexData, noise } });
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
  }, [store, biome, region, getVertexData, noiseKey, worldKey]);

  return null;
};
