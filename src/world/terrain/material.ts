import * as THREE from "three";
import { _curvature } from "../../vfx/curvature";
import { _material } from "../../utils/material/_material";
import { _quantization } from "../../vfx/quantization";
import { getAllBiomes } from "../../utils/utils";
import { biomeSlotBlendHalvesOf, biomeSlotRegionsOf, biomeSlotsOf, riverbedSlotHalvesOf } from "../../utils/workers/vertexCompute";
import { getActiveDomainConfig, getActiveRegions, getRiverTexture, getTerrainParams, whenDomainReady } from "../domains/utils";
import { combineBiomeMaterials } from "../shaders/combineBiomeMaterials";
import { glslFloat, TERRAIN_TEXTURE_TILE, WORLD_WRAP } from "../shaders/constants";
import { LOD_FADE_DEFINE, LOD_FADE_UNIFORM } from "../shaders/lodFade";
import { FAR_DISTANCE_GLSL, FAR_FADE_DEFINE, FAR_FADE_UNIFORM, FAR_FADE_UNIFORMS } from "../shaders/farFade";
import { FADE_OPAQUE_HI } from "./lodSwaps";
import terrainVertexBody from "../shaders/vertex.glsl";

// The raw .glsl asset can't import the shared chunks, so they are prepended here.
const vertexShader = `${_quantization.QUANTIZE_GLSL}\n${_curvature.CURVE_GLSL}\n${FAR_DISTANCE_GLSL}\n${terrainVertexBody}`;

/** Two vec4 attributes carry the per-biome signed distances (two more the presences, two the riverbed's). */
export const MAX_BIOME_SLOTS = 8;

/** Combines every active region's base and biome fragment shader into the one terrain material. */
export const getMaterial = async () => {
  await whenDomainReady();
  const regions = getActiveRegions();
  const biomes = getAllBiomes(regions);

  // Slot k of the worker's biomeSdf is the k-th unique biome in region → biome order;
  // getAllBiomes over the committed regions yields the same order, asserted here
  // because the shader is generated from it.
  const config = getActiveDomainConfig();
  const slots = biomeSlotsOf(config);
  if (biomes.length > MAX_BIOME_SLOTS) throw new Error(`terrain material supports ${MAX_BIOME_SLOTS} biomes, got ${biomes.length}`);
  biomes.forEach((b, i) => {
    if (slots[i] !== b.id) throw new Error(`biome slot order mismatch at ${i}: config ${slots[i]} vs regions ${b.id}`);
  });

  const [riverTexture] = await _material.loadTextures([getRiverTexture()]);
  // Per-biome riverbeds (slot order), each distinct file loaded once.
  const slotRiverbeds = biomes.map((b) => b.riverbed);
  const bedFiles = [...new Set(slotRiverbeds.flatMap((bed) => (bed ? [bed.texture] : [])))];
  const bedTextures = await _material.loadTextures(bedFiles);
  const riverbedTextures = new Map(bedFiles.map((file, i) => [file, bedTextures[i]]));

  // Shared literals the shaders read as defines, never retyped in a .glsl.
  const params = getTerrainParams();
  const defines = {
    WORLD_WRAP: glslFloat(WORLD_WRAP),
    TEXTURE_TILE: glslFloat(TERRAIN_TEXTURE_TILE),
    ROAD_HALF_WIDTH: glslFloat(params.cityConfig.roadWidth),
    /** REAL units — lane paint is drawn from real distance. */
    FREEWAY_HALF_WIDTH: glslFloat(params.cityConfig.freewayWidth),
    RIVER_HALF_WIDTH: glslFloat(params.river.halfWidth),
    RIVER_BED_REACH: glslFloat(params.river.halfWidth + params.river.bank),
  };

  const material = await combineBiomeMaterials(biomes, regions, vertexShader, {
    riverTexture,
    slotRiverbeds,
    riverbedTextures,
    defines,
    slotHalves: biomeSlotBlendHalvesOf(config),
    bedSlotHalves: riverbedSlotHalvesOf(config),
    slotRegions: biomeSlotRegionsOf(config),
    varyingDeclarations: [
      "varying vec4 vBiomeSdf0;",
      "varying vec4 vBiomeSdf1;",
      "varying vec4 vBiomePresence0;",
      "varying vec4 vBiomePresence1;",
      "varying vec4 vRiverbedSdf0;",
      "varying vec4 vRiverbedSdf1;",
      "varying float vRiverBedDistance;",
      "varying float vDistanceToRoadCenter;",
      "varying float vDistanceToFreewayCenter;",
      "varying float vFreewayAlong;",
      "varying float vUnderwaterDepth;",
      "varying vec2 vUv;",
      "varying vec2 vWorldUv;",
      "varying float vSlopeAngle;",
      "varying float vHeight;",
      "varying vec3 vWorldNormal;",
      "varying vec3 vWorldPosWrapped;",
      "varying vec3 vWorldPosAbs;",
      "varying float vFarDistance;",
      "varying float vSkirt;",
    ],
  });

  material.uniforms.uGridSize = _quantization.uniforms.uGridSize;
  // Shared uniform OBJECTS so the terrain bends in lockstep with everything on
  // it; assigned here (vertex-only) to stay out of the generated fragment block.
  material.uniforms.uCurveStart = _curvature.uniforms.uCurveStart;
  material.uniforms.uCurveK = _curvature.uniforms.uCurveK;
  // Read only by the variants compiled with FAR_FADE_DEFINE.
  material.uniforms[FAR_FADE_UNIFORM] = FAR_FADE_UNIFORMS[FAR_FADE_UNIFORM];

  return material;
};

/** The same program source with extra defines: every uniform object is SHARED with the base. */
const terrainVariant = (base: THREE.ShaderMaterial, defines: Record<string, string>, uniforms: Record<string, THREE.IUniform> = {}): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: { ...base.uniforms, ...uniforms },
    defines: { ...base.defines, ...defines },
    vertexShader: base.vertexShader,
    fragmentShader: base.fragmentShader,
    lights: base.lights,
  });

/** The opaque material of chunks reaching the far fade (lodConfig.ts chunkReachesFarFade): the far-fade `discard` compiled in. Its own
 *  program, so the near terrain keeps its early depth test. */
export const createFarFadeMaterial = (base: THREE.ShaderMaterial): THREE.ShaderMaterial => terrainVariant(base, { [FAR_FADE_DEFINE]: "" });

/** The terrain material's LOD cross-fade twin (lodSwaps.ts): the dither `discard` compiled in, drawn only by
 *  chunks mid-fade. It carries the far fade too, so a far chunk mid-swap still dissolves at the horizon. Every
 *  uniform object is SHARED with the opaque material except the per-mesh dither range. */
export const createLodFadeMaterial = (base: THREE.ShaderMaterial): THREE.ShaderMaterial =>
  terrainVariant(base, { [LOD_FADE_DEFINE]: "", [FAR_FADE_DEFINE]: "" }, { [LOD_FADE_UNIFORM]: { value: new THREE.Vector2(0, FADE_OPAQUE_HI) } });
