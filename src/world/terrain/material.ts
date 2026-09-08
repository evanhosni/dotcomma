import { _curvature } from "../../vfx/curvature";
import { _material } from "../../utils/material/_material";
import { _quantization } from "../../utils/quantization/quantization";
import { getAllBiomes } from "../../utils/utils";
import { getActiveRegions, getRiverTexture, getTerrainParams, whenDomainReady } from "../domains/utils";
import { glslFloat, WORLD_WRAP } from "../shaders/constants";
import terrainVertexBody from "../shaders/vertex.glsl";

// quantizeWorldPos() / curveViewPos() come from their single sources — the
// raw .glsl asset can't import them, so they are prepended here.
const vertexShader = `${_quantization.QUANTIZE_GLSL}\n${_curvature.CURVE_GLSL}\n${terrainVertexBody}`;

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

  // Numbers the .glsl assets used to retype by hand (and had to keep in sync
  // with world/defaults.ts): the wrap period and the city band widths.
  const params = getTerrainParams();
  const defines = {
    WORLD_WRAP: glslFloat(WORLD_WRAP),
    /** Street half-width (centerline → curb) — the unit of the normalized road field. */
    ROAD_HALF_WIDTH: glslFloat(params.cityConfig.roadWidth),
    /** Freeway half-width in REAL units (lane paint is drawn from real distance). */
    FREEWAY_HALF_WIDTH: glslFloat(params.cityConfig.freewayWidth),
    /** Biome-boundary band width. */
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
      "varying vec3 vWorldPos;",
      "varying vec3 vWorldPosAbs;",
    ],
  });

  material.uniforms.uGridSize = _quantization.uniforms.uGridSize;
  // World curvature — shared uniform objects, so the terrain bends in lockstep
  // with everything standing on it (see vfx/curvature.ts). Assigned here rather
  // than through combineBiomeMaterials so they stay out of the generated
  // fragment-shader uniform block: they are vertex-only.
  material.uniforms.uCurveStart = _curvature.uniforms.uCurveStart;
  material.uniforms.uCurveK = _curvature.uniforms.uCurveK;
  // fwidth() in the city shader guards the freeway lane paint against
  // dash-phase interpolation sweeps — a core GLSL ES 3.0 builtin under WebGL2
  // (three ≥ r158 dropped `extensions.derivatives`; nothing to enable).

  return material;
};
