import * as THREE from "three";
import { _material } from "../../utils/material";
import { getAllBiomes } from "../../utils/utils";
import { biomeSlotBlendHalvesOf, biomeSlotRegionsOf, biomeSlotsOf, riverbedSlotHalvesOf } from "../../utils/workers/vertexCompute";
import { getActiveDomainConfig, getActiveRegions, getRiverTexture, getTerrainParams, whenDomainReady } from "../domains/utils";
import { combineBiomeMaterials } from "../shaders/combineBiomeMaterials";
import { CHUNK_PROJECTION_GLSL, CHUNK_PROJECTION_UNIFORMS, CHUNK_PROJECTION_VARYINGS } from "../shaders/chunkProjection";
import { glslFloat, TERRAIN_TEXTURE_TILE, WORLD_WRAP } from "../shaders/constants";
import { LOD_FADE_DEFINE, LOD_FADE_UNIFORM } from "../shaders/lodFade";
import { FAR_FADE_DEFINE, FAR_FADE_UNIFORM, FAR_FADE_UNIFORMS, WIREFRAME_DEFINE } from "../shaders/farFade";
import { ENTRANCE_PATCH_DEFINE, TERRAIN_HOLES_DEFINE } from "../shaders/terrainHoles";
import { FADE_OPAQUE_HI } from "./lodSwaps";
import terrainVertexBody from "../shaders/vertex.glsl";

// The raw .glsl asset can't import the shared chunks, so the chunk projection is prepended here.
const vertexShader = `${CHUNK_PROJECTION_GLSL}\n${terrainVertexBody}`;

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
    ...(params.wireframe ? { [WIREFRAME_DEFINE]: "" } : {}),
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
      "varying float vFarSnow;",
      "varying vec2 vUv;",
      "varying vec2 vWorldUv;",
      "varying float vSlopeAngle;",
      "varying float vHeight;",
      "varying float vSkirt;",
      ...CHUNK_PROJECTION_VARYINGS,
    ],
  });

  // Shared uniform OBJECTS so the terrain bends and snaps in lockstep with everything on it; assigned
  // here (vertex-only) to stay out of the generated fragment block.
  Object.assign(material.uniforms, CHUNK_PROJECTION_UNIFORMS);
  material.wireframe = params.wireframe;
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
    wireframe: base.wireframe,
  });

/** The terrain's ONE `discard` program: the LOD cross-fade's dither (lodSwaps.ts), the far fade and the
 *  tunnel openings. Drawn by every chunk mid-fade, and by the settled chunks that reach the far fade
 *  (lodConfig.ts chunkReachesFarFade), touch an opening (terrainHoles.ts) or draw while the player is
 *  underground (no skirts: a uniform) — a settled chunk's dither range is [0, FADE_OPAQUE_HI), which keeps
 *  every pixel. One program, not one per combination: Firefox links each on the main thread (~0.6s per
 *  terrain program, PERFORMANCE.md). The near terrain keeps the base program and its early depth test.
 *  Every uniform object is SHARED with the base except the per-mesh dither range (chunkObjects.ts syncLodFade). */
export const createDiscardMaterial = (base: THREE.ShaderMaterial): THREE.ShaderMaterial =>
  terrainVariant(base, { [LOD_FADE_DEFINE]: "", [FAR_FADE_DEFINE]: "", [TERRAIN_HOLES_DEFINE]: "" }, { [LOD_FADE_UNIFORM]: { value: new THREE.Vector2(0, FADE_OPAQUE_HI) } });

/** The entrance PATCH's program: the terrain's own, with the rock share and daylight attribute and its mouth's fade. */
export const createEntranceMaterial = (base: THREE.ShaderMaterial): THREE.ShaderMaterial => terrainVariant(base, { [ENTRANCE_PATCH_DEFINE]: "" });

// ── Publication: the entrance patches wait on the base material (linked at load with the other programs).

let published: { base: THREE.ShaderMaterial; entrance: THREE.ShaderMaterial } | null = null;
let resolveReady: ((m: { base: THREE.ShaderMaterial; entrance: THREE.ShaderMaterial }) => void) | null = null;
let ready = new Promise<{ base: THREE.ShaderMaterial; entrance: THREE.ShaderMaterial }>((resolve) => {
  resolveReady = resolve;
});

export const publishTerrainMaterial = (base: THREE.ShaderMaterial, entrance: THREE.ShaderMaterial): void => {
  published = { base, entrance };
  if (resolveReady) {
    resolveReady(published);
    resolveReady = null;
  }
};

/** Resolves once the terrain material (and its entrance variant) exists; re-armed by a reset. */
export const terrainMaterialReady = (): Promise<{ base: THREE.ShaderMaterial; entrance: THREE.ShaderMaterial }> => ready;

export const resetTerrainMaterial = (): void => {
  published = null;
  ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
};

