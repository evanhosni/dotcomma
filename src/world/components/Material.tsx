import { useContext, useLayoutEffect } from "react";
import { _material } from "../../utils/material/_material";
import { MaterialData, RegionMaterialData } from "../types";
import { BiomeContext, RegionContext, useWorldStore } from "./context";

export interface MaterialConfigProps {
  /** World scope: texture filename (public/textures/) blended near region boundaries (rivers). */
  riverTexture?: string;
  /** Region scope: texture filename blended near biome boundaries within the region. */
  texture?: string;
  /** Region scope alternative to `texture`: custom async loader. */
  getRegionMaterial?: () => Promise<RegionMaterialData>;
  /** Biome scope: returns the biome's fragment shader + uniforms. */
  getMaterial?: () => Promise<MaterialData>;
}

/**
 * Scope-aware material config. Where it's mounted decides what it configures:
 *
 * - Inside <World>:  the river texture blended between regions.
 * - Inside <Region>: the biome-boundary texture for that region.
 * - Inside <Biome>:  the biome's terrain fragment shader (`getMaterial`).
 *
 * Renders nothing — pure registration.
 */
export const Material = ({ riverTexture, texture, getRegionMaterial, getMaterial }: MaterialConfigProps) => {
  const store = useWorldStore("Material");
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
    store.worldMaterial = { riverTexture };
    store.invalidate();
    return () => {
      store.worldMaterial = null;
      store.invalidate();
    };
  }, [store, biome, region, riverTexture, texture, getRegionMaterial, getMaterial]);

  return null;
};
