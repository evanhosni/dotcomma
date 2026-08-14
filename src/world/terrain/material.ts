import { _material } from "../../utils/material/_material";
import { _quantization } from "../../utils/quantization/quantization";
import { getAllBiomes } from "../../utils/utils";
import { getActiveRegions, getRiverTexture, whenDomainReady } from "../domains/utils";
import vertexShader from "../shaders/vertex.glsl";

/** Combines every active biome's fragment shader into the terrain material.
 *  Regions/biomes and the river texture come from the active domain committed by
 *  the <Domain> component tree (world-level <Material riverTexture=…>). */
export const getMaterial = async () => {
  await whenDomainReady();
  const regions = getActiveRegions();
  const biomes = getAllBiomes(regions);

  // Load the river texture (between regions)
  const [riverTexture] = await _material.loadTextures([getRiverTexture()]);

  // Collect region biome boundary textures
  const regionMaterials = await Promise.all(
    regions.map(async (region) => (region.getMaterial ? await region.getMaterial() : null))
  );

  // For now, use the first region's biome boundary texture
  // TODO: Handle multiple regions with different biome boundary textures
  const biomeTexture = regionMaterials.find((m) => m)?.biomeTexture;

  const material = await _material.combineBiomeMaterials(biomes, vertexShader, {
    riverTexture,
    biomeTexture,
    varyingDeclarations: [
      "varying float vDistanceToBiomeBoundaryCenter;",
      "varying float vDistanceToRiverCenter;",
      "varying float vDistanceToRoadCenter;",
      "varying float vDistanceToFreewayCenter;",
      "varying float vFreewayAlong;",
      "flat varying int vBiomeId;",
      "varying vec2 vUv;",
      "varying vec2 vWorldUv;",
      "varying float vSlopeAngle;",
      "varying float vHeight;",
      "varying vec3 vWorldNormal;",
      "varying vec3 vWorldPos;",
      "varying vec3 vWorldPosAbs;",
    ],
  });

  material.uniforms.uGridSize = _quantization.uniforms.uGridSize;
  // fwidth() in the city shader guards the freeway lane paint against
  // dash-phase interpolation sweeps (GLSL1 needs the derivatives extension).
  material.extensions.derivatives = true;

  return material;
};
