import { _material } from "../../utils/material/_material";
import { utils } from "../../utils/utils";
import { GlitchCity } from "./GlitchCity";
import vertexShader from "./shaders/vertex.glsl";

export const getMaterial = async () => {
  const biomes = utils.getAllBiomes(GlitchCity);
  const regions = GlitchCity.regions;

  // Load the boundary texture (between regions)
  const [regionTexture] = await _material.loadTextures(["mahir.jpg"]);

  // Collect region biome boundary textures
  const regionMaterials = await Promise.all(
    regions.map(async (region) => (region.getMaterial ? await region.getMaterial() : null))
  );

  // For now, use the first region's biome boundary texture
  // TODO: Handle multiple regions with different biome boundary textures
  const biomeTexture = regionMaterials.find((m) => m)?.biomeTexture;

  return _material.combineBiomeMaterials(biomes, vertexShader, {
    regionTexture,
    biomeTexture,
    varyingDeclarations: [
      "varying float vDistanceToBiomeBoundaryCenter;",
      "varying float vDistanceToRegionBoundaryCenter;",
      "varying float vDistanceToRoadCenter;",
      "flat varying int vBiomeId;",
      "varying vec2 vUv;",
    ],
  });
};
