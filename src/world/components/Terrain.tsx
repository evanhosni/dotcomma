import { useContext, useLayoutEffect } from "react";
import { TerrainParams } from "../types";
import { BiomeContext, RegionContext, reportHierarchyError, useDomainStore } from "./context";

export interface TerrainConfigProps extends Partial<TerrainParams> {}

/** The domain's global TerrainParams (unset → world/defaults.ts). Domain scope only: a region's
 *  relief is its spec's `baseNoise` and a biome's its spec's `noise`, which <Region>/<Biome>
 *  register themselves — the server's config reads the same specs. */
export const Terrain = (params: TerrainConfigProps) => {
  const store = useDomainStore("Terrain");
  const biome = useContext(BiomeContext);
  const region = useContext(RegionContext);
  if (biome || region) {
    reportHierarchyError("<Terrain> is domain-scoped: set `baseNoise` in the region's spec.ts / `noise` in the biome's spec.ts");
  }
  // Stringified deps: inline JSX literals must not re-commit the world per parent render.
  const paramsKey = JSON.stringify(params);

  useLayoutEffect(() => {
    store.domainTerrain = params;
    store.invalidate();
    return () => {
      store.domainTerrain = null;
      store.invalidate();
    };
  }, [store, paramsKey]);

  return null;
};
