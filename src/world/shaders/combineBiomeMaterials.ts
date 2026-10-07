import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL } from "../../lighting/dayNight";
import { LAMP_GRID_UNIFORMS, lampGlowAccumGLSL } from "../../lighting/lampGlow";
import { reportContentError } from "../../utils/contentError";
import { textureFileOf } from "../../utils/material/_material";
import { ditherGLSL } from "../../vfx/dither";
import { CITY_BIOME_ID } from "../constants";
import { Biome, MaterialData, Region, RiverbedMaterial } from "../types";
import commonShader from "./common.glsl";
import {
  FREEWAY_CORRIDOR_INNER,
  FREEWAY_CORRIDOR_OUTER,
  RIVER_BED_FADE_INSET,
  RIVER_BED_FULL_INSET,
  RIVER_BED_SLOPE_END_DEG,
  RIVER_BED_SLOPE_START_DEG,
  bedYieldsToSteepGround,
  glslFloat,
} from "./constants";
import { LOD_FADE_DEFINE, LOD_FADE_GLSL, LOD_FADE_UNIFORM } from "./lodFade";
import { SKIRT_TINT_GLSL, SKIRT_TINT_UNIFORM, skirtTintUniform } from "./skirtTint";

// THE TERRAIN FRAGMENT SHADER GENERATOR: every region's base shader and every biome's shader become
// named functions of ONE program, mixed per pixel (shaders/README.md walks through the result).

/** cos of a slope in degrees as a GLSL literal: compared against the world normal's y. */
const cosDegGLSL = (deg: number): string => Math.cos((deg * Math.PI) / 180).toFixed(6);

/** Below this a biome's fragment function is skipped: its color could not be seen. */
const BIOME_WEIGHT_VISIBLE = 0.002;

const reportShaderError = (message: string): void => reportContentError(`[terrain material] ${message}`);

const GLSL_KEYWORDS = new Set(["if", "else", "for", "while", "do", "switch", "return"]);

/** Names a shader chunk defines at file scope (functions, consts, #defines): they share ONE
 *  program with every other biome/region chunk and common.glsl. */
const fileScopeNames = (source: string): string[] => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const names: string[] = [];
  for (const m of code.matchAll(/^[ \t]*#define[ \t]+(\w+)/gm)) names.push(m[1]);
  const flat = code.replace(/^[ \t]*#.*$/gm, "");
  let depth = 0;
  let statementStart = 0;
  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i];
    if (ch === "{") {
      if (depth === 0) {
        const fn = /(\w+)\s+(\w+)\s*\([^()]*\)\s*$/.exec(flat.slice(statementStart, i));
        if (fn && !GLSL_KEYWORDS.has(fn[1])) names.push(fn[2]);
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) statementStart = i + 1;
    } else if (ch === ";" && depth === 0) {
      const decl = /\bconst\s+\w+\s+(\w+)/.exec(flat.slice(statementStart, i));
      if (decl) names.push(decl[1]);
      statementStart = i + 1;
    }
  }
  return names;
};

const COMMON_NAMES = fileScopeNames(commonShader);

/** Two chunks defining the same file-scope name would not compile, and the GLSL error names neither biome. */
const assertUniqueFileScopeNames = (chunks: { owner: string; source: string }[]): void => {
  const ownerOf = new Map<string, string>(COMMON_NAMES.map((n) => [n, "world/shaders/common.glsl"]));
  for (const { owner, source } of chunks) {
    for (const name of fileScopeNames(source)) {
      const other = ownerOf.get(name);
      if (other && other !== owner) {
        reportShaderError(`${owner} and ${other} both define "${name}" — terrain shader chunks share one program; prefix the helper with the biome's name`);
      }
      ownerOf.set(name, owner);
    }
  }
};

const describeUniformValue = (value: unknown): string =>
  value instanceof THREE.Texture ? `texture ${textureFileOf(value) ?? value.uuid}` : JSON.stringify(value);

const uniformDeclarationOf = (name: string, uniform: { value: any }): string => {
  const v = uniform.value;
  if (v instanceof THREE.Texture || v === null) return `uniform sampler2D ${name};`;
  if (typeof v === "number") return `uniform float ${name};`;
  if (v instanceof THREE.Vector2) return `uniform vec2 ${name};`;
  if (v instanceof THREE.Vector3) return `uniform vec3 ${name};`;
  if (v instanceof THREE.Vector4) return `uniform vec4 ${name};`;
  return `uniform sampler2D ${name};`;
};

/** GLSL expression reading biome slot k's value from a pair of vec4 varyings. */
const slotOf = (prefix: string, k: number): string => `${prefix}${k < 4 ? 0 : 1}[${k % 4}]`;

const MAIN_RE = /void\s+main\s*\(\s*(?:void\s*)?\)\s*\{/;
const GLSL_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A biome's or region's fragment shader turned into a named function writing gl_FragColor. */
const toFragFunction = (fragmentShader: string, name: string): string => {
  if (!GLSL_IDENTIFIER_RE.test(name) || name.startsWith("gl_") || name.includes("__")) {
    reportShaderError(`"${name}" is not a usable GLSL identifier — biome and region names must be lowercase letters`);
  }
  if (!MAIN_RE.test(fragmentShader)) reportShaderError(`${name}: the shader has no \`void main() {\``);
  return fragmentShader
    .replace(/(?:varying|uniform)\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+\w+\s*;/g, "")
    .replace(/^\s*[\r\n]/gm, "")
    .replace(MAIN_RE, `void ${name}() {`)
    .trim();
};

/** Uniform names are global across every chunk: a second declaration must carry the same value. */
const mergeUniforms = (
  target: Record<string, { value: unknown }>,
  owners: Map<string, string>,
  uniforms: Record<string, { value: unknown }>,
  owner: string,
): void => {
  for (const [name, uniform] of Object.entries(uniforms)) {
    const previous = target[name];
    if (previous && describeUniformValue(previous.value) !== describeUniformValue(uniform.value)) {
      reportShaderError(
        `${owner} declares uniform "${name}" (${describeUniformValue(uniform.value)}) but ${owners.get(name) ?? "the terrain material itself"} already declares it as ${describeUniformValue(previous.value)} — uniform names are global across every biome/region shader; rename one`,
      );
    }
    target[name] = uniform;
    owners.set(name, owner);
  }
};

/** Every region's base and biome's frag as a named function, uniforms merged in (in slot order —
 *  the merge order decides which owner an error names). */
const collectFragFunctions = async (
  biomes: Biome[],
  regions: Region[],
  uniforms: Record<string, { value: unknown }>,
): Promise<{
  functions: string[];
  /** Per region, its `<name>_base_frag` function, or null without a base material. */
  baseFunctionOf: (string | null)[];
  /** The slots whose biome has a material (a slot without one draws nothing). */
  slotsWithMaterial: number[];
}> => {
  const functions: string[] = [];
  const owners = new Map<string, string>();
  const chunks: { owner: string; source: string }[] = [];
  const addChunk = (m: MaterialData, name: string): void => {
    mergeUniforms(uniforms, owners, m.uniforms, name);
    const source = toFragFunction(m.fragmentShader, name);
    functions.push(source);
    chunks.push({ owner: name, source });
  };

  const baseFunctionOf: (string | null)[] = [];
  for (const region of regions) {
    if (!region.getMaterial) {
      baseFunctionOf.push(null);
      continue;
    }
    const name = `${region.name}_base_frag`;
    addChunk(await region.getMaterial(), name);
    baseFunctionOf.push(name);
  }

  const slotsWithMaterial: number[] = [];
  for (let k = 0; k < biomes.length; k++) {
    const biome = biomes[k];
    if (!biome.getMaterial) continue;
    addChunk(await biome.getMaterial(), `${biome.name}_frag`);
    slotsWithMaterial.push(k);
  }
  assertUniqueFileScopeNames(chunks);
  return { functions, baseFunctionOf, slotsWithMaterial };
};

/** RIVERBED GROUPS: slots with the same bed share one weight and one texture sample; group 0 is the
 *  domain's river texture. A sampler per distinct FILE, never per biome — the shader is already near
 *  the 16 texture units. */
const groupRiverbeds = (slotCount: number, slotRiverbeds: (RiverbedMaterial | undefined)[]): { bedKeys: string[]; bedGroupOf: number[] } => {
  const bedKeys: string[] = ["domain"];
  const bedGroupOf = Array.from({ length: slotCount }, (_, k) => {
    const bed = slotRiverbeds[k];
    if (!bed) return 0;
    const key = JSON.stringify(bed);
    let g = bedKeys.indexOf(key);
    if (g < 0) g = bedKeys.push(key) - 1;
    return g;
  });
  return { bedKeys, bedGroupOf };
};

const riverbedUniformOf = (file: string) => `riverbed_${file.replace(/[^A-Za-z0-9]/g, "_")}`;

/** Riverbed group g's color at `bedUV`: the domain's river texture, or a biome bed desaturated and tinted. */
const riverbedSampleGLSL = (g: number, bedKeys: string[]): string => {
  if (g === 0) return "texture2D(rivertexture, bedUV).rgb";
  const bed = JSON.parse(bedKeys[g]) as RiverbedMaterial;
  const tint = bed.tint ?? [1, 1, 1];
  const vec = (v: number[]) => `vec3(${v.map((c) => c.toFixed(4)).join(", ")})`;
  return `(mix(vec3(dot(texture2D(${riverbedUniformOf(bed.texture)}, bedUV).rgb, vec3(0.299, 0.587, 0.114))), texture2D(${riverbedUniformOf(bed.texture)}, bedUV).rgb, ${(bed.saturation ?? 1).toFixed(4)}) * ${vec(tint)})`;
};

/** Slots grouped into tiers of equal feather half-width, crispest first (mirrors the worker's combineSlotWeights). */
const crispnessTiers = (slots: number[], halfOf: (k: number) => number): number[][] => {
  const tiers: number[][] = [];
  for (const k of [...slots].sort((a, b) => halfOf(a) - halfOf(b))) {
    const last = tiers[tiers.length - 1];
    if (last && halfOf(last[0]) === halfOf(k)) last.push(k);
    else tiers.push([k]);
  }
  return tiers;
};

/** Everything that is not a biome frag: the LOD fade, the scene's point lights. */
const TERRAIN_FRAGMENT_DECLARATIONS_GLSL = `#ifdef ${LOD_FADE_DEFINE}
      uniform vec2 ${LOD_FADE_UNIFORM};
      ${LOD_FADE_GLSL}
    #endif

    #if NUM_POINT_LIGHTS > 0
      struct PointLight {
        vec3 position;
        vec3 color;
        float distance;
        float decay;
      };
      uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
    #endif`;

// Lambert from the scene point lights (pointLights[i].position is VIEW space, color premultiplied by
// intensity). ABSOLUTE position: the wrapped one lit the wrong chunks. Gated on the night blend because
// every scene point light follows it. Parked pool lights have color 0: a uniform-coherent skip.
const POINT_LIGHTS_GLSL = `#if NUM_POINT_LIGHTS > 0
      if (uNightBlend > 0.001) {
        vec3 plViewPos = (viewMatrix * vec4(vWorldPosAbs, 1.0)).xyz;
        vec3 plViewNormal = normalize((viewMatrix * vec4(vWorldNormal, 0.0)).xyz);
        vec3 pointLightSum = vec3(0.0);
        for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
          vec3 lCol = pointLights[i].color;
          if (dot(lCol, lCol) < 1e-6) continue;
          vec3 lVec = pointLights[i].position - plViewPos;
          float lDist = max(length(lVec), 0.001);
          float atten = 1.0 / max(pow(lDist, pointLights[i].decay), 0.01);
          if (pointLights[i].distance > 0.0) {
            float edge = clamp(1.0 - pow(lDist / pointLights[i].distance, 4.0), 0.0, 1.0);
            atten *= edge * edge;
          }
          float ndotl = clamp(dot(plViewNormal, lVec / lDist), 0.0, 1.0);
          pointLightSum += lCol * (ndotl * atten);
        }
        gl_FragColor.rgb += gl_FragColor.rgb * pointLightSum;
      }
      #endif`;

interface BiomeMixInput {
  biomes: Biome[];
  slotsWithMaterial: number[];
  baseFunctionOf: (string | null)[];
  slotRegions?: number[];
  slotHalves?: number[];
}

/** Slot k's color `c<k>`: its region base faded into its own frag by presence. */
const biomeColorGLSL = (k: number, { biomes, baseFunctionOf, slotRegions }: BiomeMixInput): string => {
  const base = slotRegions ? baseFunctionOf[slotRegions[k]] : null;
  if (!base) return `${biomes[k].name}_frag(); vec4 c${k} = gl_FragColor;`;
  return `float p${k} = smoothstep(0.0, 1.0, ${slotOf("vBiomePresence", k)});
          ${base}(); vec4 c${k} = gl_FragColor;
          if (p${k} > 0.001) { ${biomes[k].name}_frag(); c${k} = mix(c${k}, gl_FragColor, p${k}); }`;
};

/** The per-pixel biome cross-fade: each tier claims `remaining × weight`, softer tiers split the rest. */
const biomeMixGLSL = (input: BiomeMixInput): string[] => {
  const halfOf = (k: number) => input.slotHalves?.[k] ?? 1;
  const tiers = crispnessTiers(input.slotsWithMaterial, halfOf);
  return tiers.map(
    (tier, t) => `{
        ${tier.map((k) => `float w${k} = smoothstep(-1.0, 1.0, ${slotOf("vBiomeSdf", k)});`).join("\n        ")}
        float tierSum = ${tier.map((k) => `w${k}`).join(" + ")};
        float tierScale = remaining * (tierSum >= 1.0 ? 1.0 / tierSum : 1.0);
        ${tier
          .map(
            (k) => `if (w${k} * tierScale > ${BIOME_WEIGHT_VISIBLE}) {
          ${biomeColorGLSL(k, input)}
          blended += c${k} * (w${k} * tierScale);
          weightSum += w${k} * tierScale;
        }`,
          )
          .join("\n        ")}
        ${t < tiers.length - 1 ? "remaining *= max(0.0, 1.0 - tierSum);" : ""}
      }`,
  );
};

/** The riverbed groups' weights `bedW<g>`, from the RIVERBED's own slot distances (vRiverbedSdf — the
 *  biome walls' feathers floored at RIVER_BED_TEXTURE_HALF) in the same crispness tiers as the ground:
 *  by the ground's own weights the bed's texture switched within 1u beside the crisp city. `bedRock`
 *  sums the ROCK slots' weights (`rockSlots`). */
const riverbedWeightsGLSL = (slotCount: number, bedGroupOf: number[], bedHalves: number[] | undefined, rockSlots: boolean[]): string => {
  const slots = Array.from({ length: slotCount }, (_, k) => k);
  const tiers = crispnessTiers(slots, (k) => bedHalves?.[k] ?? 1);
  return tiers
    .map(
      (tier, t) => `{
        ${tier.map((k) => `float r${k} = smoothstep(-1.0, 1.0, ${slotOf("vRiverbedSdf", k)});`).join("\n        ")}
        float bedTierSum = ${tier.map((k) => `r${k}`).join(" + ")};
        float bedTierScale = bedRemaining * (bedTierSum >= 1.0 ? 1.0 / bedTierSum : 1.0);
        ${tier.map((k) => `bedW${bedGroupOf[k]} += r${k} * bedTierScale;${rockSlots[k] ? ` bedRock += r${k} * bedTierScale;` : ""}`).join("\n        ")}
        ${t < tiers.length - 1 ? "bedRemaining *= max(0.0, 1.0 - bedTierSum);" : ""}
      }`,
    )
    .join("\n        ");
};

/** River BED and BANKS: the riverbed from the channel out to the bank's edge, fading into the ground
 *  beyond over RIVER_BED_BLEND_WIDTH (the Water system draws the surface) — each biome's own bed,
 *  cross-faded softly across biome walls (riverbedWeightsGLSL). It yields where the CITY's road field
 *  says pavement (a quay's asphalt, curb and 4u sidewalk band, crisp: the sidewalk along a river is as
 *  wide as along any road) and on steep banks of ROCK (`rockSlots`: a domed biome — a mountainside
 *  keeps its rock). Any other ground (grass, dunes, snow) never yields to slope: it cut into the band in
 *  wedges reaching the water wherever a bank steepened (Evan, screenshot at (-8900, 1100)). */
const riverBedGLSL = (bedKeys: string[], bedGroupOf: number[], bedHalves: number[] | undefined, cityIdx: number, rockSlots: boolean[]): string => `if (vRiverBedDistance < RIVER_BED_REACH) {
        vec2 bedUV = fract(vWorldUv);
        ${bedKeys.map((_, g) => `float bedW${g} = 0.0;`).join(" ")}
        float bedRemaining = 1.0;
        float bedRock = 0.0;
        ${riverbedWeightsGLSL(bedGroupOf.length, bedGroupOf, bedHalves, rockSlots)}
        vec3 bed = vec3(0.0);
        float bedSum = 0.0;
        ${bedKeys.map((_, g) => `if (bedW${g} > ${BIOME_WEIGHT_VISIBLE}) { bed += ${riverbedSampleGLSL(g, bedKeys)} * bedW${g}; bedSum += bedW${g}; }`).join("\n        ")}
        vec4 riverColor = vec4(bed / max(bedSum, 1e-4), 1.0);
        riverColor.rgb *= mix(vec3(0.72, 0.7, 0.66), vec3(1.0), smoothstep(RIVER_HALF_WIDTH * 0.5, RIVER_HALF_WIDTH * 1.3, vRiverBedDistance));
        float riverBlend = smoothstep(RIVER_BED_REACH - ${glslFloat(RIVER_BED_FULL_INSET)}, RIVER_BED_REACH - ${glslFloat(RIVER_BED_FADE_INSET)}, vRiverBedDistance);
        float pavement = ${cityIdx >= 0 ? `smoothstep(-1.0, 1.0, ${slotOf("vBiomeSdf", cityIdx)})` : "0.0"} * (1.0 - smoothstep(ROAD_HALF_WIDTH + 4.0, ROAD_HALF_WIDTH + 5.0, vDistanceToRoadCenter));
        float bedSteep = (1.0 - smoothstep(${cosDegGLSL(RIVER_BED_SLOPE_END_DEG)}, ${cosDegGLSL(RIVER_BED_SLOPE_START_DEG)}, normalize(vWorldNormal).y)) * min(bedRock, 1.0);
        gl_FragColor = mix(riverColor, gl_FragColor, max(max(riverBlend, pavement), bedSteep));
      }`;

/** Freeways OUTSIDE the city (the inter-city runs, the outer half of every belt) painted over the
 *  finished biome mix and riverbed with the CITY'S OWN frag, so a run is the same asphalt, curb and lane
 *  paint as the belt it merges into (inside one biome's frag it would fade with that biome's presence).
 *  Not gated on being outside the city: on the wall the 2u material feather would mix the neighbor's
 *  ground into the belt's centerline. Empty without a city biome (or one without a material). */
const cityCorridorGLSL = (cityName: string | null): string =>
  cityName === null
    ? ""
    : `if (vDistanceToRoadCenter < ${glslFloat(FREEWAY_CORRIDOR_OUTER)}) {
        float corridor = 1.0 - smoothstep(${glslFloat(FREEWAY_CORRIDOR_INNER)}, ${glslFloat(FREEWAY_CORRIDOR_OUTER)}, vDistanceToRoadCenter);
        vec4 ground = gl_FragColor;
        ${cityName}_frag();
        gl_FragColor = mix(ground, gl_FragColor, corridor);
      }`;

/**
 * One terrain material for every biome. `biomes` is in SLOT order: slot k's signed
 * distance is vBiomeSdf0/1[k] and its presence vBiomePresence0/1[k]. Each biome's
 * color is its region's BASE (`regions[slotRegions[k]]`) where its presence is 0 (its
 * own edge) and its own frag where it is 1; the per-biome colors then combine by
 * weight in CRISPNESS tiers (`slotHalves` ascending, mirroring vertexCompute's
 * combineSlotWeights) — a per-pixel cross-fade, never a per-triangle switch.
 */
export const combineBiomeMaterials = async (
  biomes: Biome[],
  regions: Region[],
  vertexShader: string,
  options: {
    riverTexture?: THREE.Texture;
    /** Per slot, its riverbed (unset = the domain's riverTexture), with each distinct texture file
     *  loaded once (`riverbedTextures`, keyed by filename). */
    slotRiverbeds?: (RiverbedMaterial | undefined)[];
    riverbedTextures?: Map<string, THREE.Texture>;
    varyingDeclarations?: string[];
    defines?: Record<string, string>;
    /** Per slot, HALF the material feather (crispness order). Unset = one tier. */
    slotHalves?: number[];
    /** Per slot, HALF the riverbed texture's feather (vRiverbedSdf's scale; crispness order). */
    bedSlotHalves?: number[];
    /** Per slot, the index into `regions` of the biome's region (its base material). */
    slotRegions?: number[];
  } = {},
): Promise<THREE.ShaderMaterial> => {
  const { riverTexture, slotRiverbeds = [], riverbedTextures = new Map(), varyingDeclarations = [], defines = {}, slotHalves, bedSlotHalves, slotRegions } = options;
  // uNightBlend and the lamp-grid uniforms are SHARED objects so every terrain material dims in lockstep.
  const combinedUniforms: any = { uNightBlend: NIGHT_BLEND_UNIFORM, ...LAMP_GRID_UNIFORMS, [SKIRT_TINT_UNIFORM]: skirtTintUniform };

  // The scene point lights' struct/array uniforms are written by the renderer (material.lights),
  // so they must NOT go through the scalar declaration generator.
  Object.assign(combinedUniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.lights));
  const LIGHTS_UNIFORM_KEYS = new Set(Object.keys(THREE.UniformsLib.lights));

  if (riverTexture) {
    combinedUniforms.rivertexture = { value: riverTexture };
  }

  const { bedKeys, bedGroupOf } = groupRiverbeds(biomes.length, slotRiverbeds);
  for (const [file, texture] of riverbedTextures) combinedUniforms[riverbedUniformOf(file)] = { value: texture };

  const { functions, baseFunctionOf, slotsWithMaterial } = await collectFragFunctions(biomes, regions, combinedUniforms);
  const blendCalls = biomeMixGLSL({ biomes, slotsWithMaterial, baseFunctionOf, slotRegions, slotHalves });

  const cityIdx = biomes.findIndex((b) => b.id === CITY_BIOME_ID);
  const cityCorridor = cityCorridorGLSL(cityIdx >= 0 && slotsWithMaterial.includes(cityIdx) ? biomes[cityIdx].name : null);

  const fragmentShader = `
    ${varyingDeclarations.join("\n    ")}

    ${Object.entries(combinedUniforms)
      .filter(([name]) => !LIGHTS_UNIFORM_KEYS.has(name))
      .map(([name, uniform]) => uniformDeclarationOf(name, uniform as { value: any }))
      .join("\n    ")}

    ${TERRAIN_FRAGMENT_DECLARATIONS_GLSL}

    ${commonShader}

    ${functions.join("\n\n    ")}

    void main() {
      // A chunk mid LOD swap draws its fade twin, which keeps only its dither share (world/terrain/lodSwaps.ts).
      #ifdef ${LOD_FADE_DEFINE}
      if (lodFadeDiscards(${LOD_FADE_UNIFORM})) discard;
      #endif
      vec4 blended = vec4(0.0);
      float weightSum = 0.0;
      float remaining = 1.0;
      ${blendCalls.join("\n      ")}
      // At a vertex the own biome's sdf is ≥ 0 (weight ≥ 0.5); inside a coarse triangle only the far
      // LODs' clamped fields keep the sum from vanishing (LODLevel.clampBlendFields) — the max is a guard.
      gl_FragColor = blended / max(weightSum, 1e-4);

      ${riverBedGLSL(bedKeys, bedGroupOf, bedSlotHalves, cityIdx, biomes.map((b) => bedYieldsToSteepGround(b.noise)))}

      ${cityCorridor}

      ${nightDimGLSL("gl_FragColor.rgb")}

      // Lamp glow after the night dim so lamps brighten the ground; ABSOLUTE position (the lamp grid's).
      ${lampGlowAccumGLSL("vWorldPosAbs")}
      gl_FragColor.rgb += lampGlowSum * 0.25;

      ${POINT_LIGHTS_GLSL}

      // Slow gradients band into rings at 8 bits without the dither.
      ${ditherGLSL("gl_FragColor.rgb")}

      ${SKIRT_TINT_GLSL}
    }
  `;

  return new THREE.ShaderMaterial({
    uniforms: combinedUniforms,
    defines,
    vertexShader,
    fragmentShader,
    lights: true,
  });
};
