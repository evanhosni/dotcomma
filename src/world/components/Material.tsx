import { useContext, useLayoutEffect } from "react";
import { _material } from "../../utils/material/_material";
import { MaterialData, RegionMaterialData } from "../types";
import { BiomeContext, RegionContext, useDomainStore } from "./context";

/** Scope-aware: under <Domain> = river texture (between regions), under
 *  <Region> = biome-boundary texture, under <Biome> = the fragment shader. */
export interface MaterialConfigProps {
  /** Filename under public/textures/. */
  riverTexture?: string;
  /** Filename under public/textures/. */
  texture?: string;
  /** Region scope alternative to `texture`. */
  getRegionMaterial?: () => Promise<RegionMaterialData>;
  getMaterial?: () => Promise<MaterialData>;
}

export const Material = ({ riverTexture, texture, getRegionMaterial, getMaterial }: MaterialConfigProps) => {
  const store = useDomainStore("Material");
  const biome = useContext(BiomeContext);
  const region = useContext(RegionContext);

  useLayoutEffect(() => {
    if (biome) {
      if (!getMaterial) return;
      const key = `${biome.regionId}/${biome.biomeId}`;
      store.biomeMaterials.set(key, { biomeId: biome.biomeId, getMaterial });
      store.invalidate();
      return () => {
        store.biomeMaterials.delete(key);
        store.invalidate();
      };
    }
    if (region) {
      const loader =
        getRegionMaterial ??
        (texture
          ? async (): Promise<RegionMaterialData> => {
              const [biomeTexture] = await _material.loadTextures([texture]);
              return { biomeTexture };
            }
          : undefined);
      if (!loader) return;
      store.regionMaterials.set(region.regionId, loader);
      store.invalidate();
      return () => {
        store.regionMaterials.delete(region.regionId);
        store.invalidate();
      };
    }
    store.domainMaterial = { riverTexture };
    store.invalidate();
    return () => {
      store.domainMaterial = null;
      store.invalidate();
    };
  }, [store, biome, region, riverTexture, texture, getRegionMaterial, getMaterial]);

  return null;
};
