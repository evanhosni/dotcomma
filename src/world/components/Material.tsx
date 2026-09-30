import { useContext, useLayoutEffect, useMemo } from "react";
import { _material } from "../../utils/material/_material";
import { MaterialData, RiverbedMaterial } from "../types";
import { BiomeContext, RegionContext, useDomainStore } from "./context";

/** Scope-aware: under <Domain> = the river texture (every biome's riverbed unless it sets its own),
 *  under <Region> = the region's BASE material (what its biomes fade into at their edges), under
 *  <Biome> = the biome's fragment shader and, optionally, its own `riverbed`. */
export interface MaterialConfigProps {
  /** Filename under public/textures/ (domain scope). */
  riverTexture?: string;
  /** The fragment shader (`void main()` writing gl_FragColor; its uniform/varying lines are stripped). */
  shader?: string;
  /** Its sampler uniforms: uniform name → filename under public/textures/. Uniform names are GLOBAL
   *  across every biome/region shader (the terrain is one material) — reuse a name only for the same file. */
  textures?: Readonly<Record<string, string>>;
  /** Instead of shader + textures: builds the material itself (non-texture uniforms). */
  getMaterial?: () => Promise<MaterialData>;
  /** Biome scope: the bed under this biome's rivers, cross-faded by the biome weights. */
  riverbed?: RiverbedMaterial;
}

export const Material = ({ riverTexture, shader, textures, getMaterial: getMaterialProp, riverbed }: MaterialConfigProps) => {
  const store = useDomainStore("Material");
  const biome = useContext(BiomeContext);
  const region = useContext(RegionContext);
  // Inline object props: registered under their JSON so parent re-renders don't re-commit.
  const riverbedKey = riverbed ? JSON.stringify(riverbed) : "";
  const texturesKey = JSON.stringify(textures ?? {});
  const getMaterial = useMemo(
    () => getMaterialProp ?? (shader !== undefined ? _material.fromShader(shader, JSON.parse(texturesKey)) : undefined),
    [getMaterialProp, shader, texturesKey],
  );

  useLayoutEffect(() => {
    if (biome) {
      if (!getMaterial && !riverbedKey) return;
      const key = `${biome.regionId}/${biome.biomeId}`;
      store.biomeMaterials.set(key, { biomeId: biome.biomeId, getMaterial, riverbed: riverbedKey ? JSON.parse(riverbedKey) : undefined });
      store.invalidate();
      return () => {
        store.biomeMaterials.delete(key);
        store.invalidate();
      };
    }
    if (region) {
      if (!getMaterial) return;
      store.regionMaterials.set(region.regionId, getMaterial);
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
  }, [store, biome, region, riverTexture, getMaterial, riverbedKey]);

  return null;
};
