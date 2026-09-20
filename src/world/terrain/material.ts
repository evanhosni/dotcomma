import { _curvature } from "../../vfx/curvature";
import { _material } from "../../utils/material/_material";
import { _quantization } from "../../utils/quantization/quantization";
import { getAllBiomes } from "../../utils/utils";
import { getActiveRegions, getRiverTexture, getTerrainParams, whenDomainReady } from "../domains/utils";
import { glslFloat, WORLD_WRAP } from "../shaders/constants";
import terrainVertexBody from "../shaders/vertex.glsl";

// The raw .glsl asset can't import the shared chunks, so they are prepended here.
const vertexShader = `${_quantization.QUANTIZE_GLSL}\n${_curvature.CURVE_GLSL}\n${terrainVertexBody}`;

/** Combines every active biome's fragment shader into the one terrain material. */
export const getMaterial = async () => {
  await whenDomainReady();
  const regions = getActiveRegions();
  const biomes = getAllBiomes(regions);

  const [riverTexture] = await _material.loadTextures([getRiverTexture()]);

  const regionMaterials = await Promise.all(
    regions.map(async (region) => (region.getBoundaryMaterial ? await region.getBoundaryMaterial() : null))
  );

  // TODO: Handle multiple regions with different biome boundary textures
  const biomeTexture = regionMaterials.find((m) => m)?.biomeTexture;

  // Defines replace literals the .glsl files used to retype by hand.
  const params = getTerrainParams();
  const defines = {
    WORLD_WRAP: glslFloat(WORLD_WRAP),
    ROAD_HALF_WIDTH: glslFloat(params.cityConfig.roadWidth),
    /** REAL units — lane paint is drawn from real distance. */
    FREEWAY_HALF_WIDTH: glslFloat(params.cityConfig.freewayWidth),
    BOUNDARY_WIDTH: glslFloat(params.boundaryWidth),
  };

  const material = await _material.combineBiomeMaterials(biomes, vertexShader, {
    riverTexture,
    biomeTexture,
    defines,
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
      "varying vec3 vWorldPosWrapped;",
      "varying vec3 vWorldPosAbs;",
    ],
  });

  material.uniforms.uGridSize = _quantization.uniforms.uGridSize;
  // Shared uniform OBJECTS so the terrain bends in lockstep with everything on
  // it; assigned here (vertex-only) to stay out of the generated fragment block.
  material.uniforms.uCurveStart = _curvature.uniforms.uCurveStart;
  material.uniforms.uCurveK = _curvature.uniforms.uCurveK;

  return material;
};
