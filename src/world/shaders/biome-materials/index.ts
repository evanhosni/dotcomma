// THE TERRAIN FRAGMENT SHADER GENERATOR: every region's base shader and every biome's shader become
// named functions of ONE program, mixed per pixel (shaders/README.md walks through the result).
import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL } from "../../../lighting/day-night/material";
import { LAMP_GRID_UNIFORMS } from "../../../lighting/lamp-glow";
import { lampGlowAccumGLSL } from "../../../lighting/lamp-glow/material";
import { PERSONAL_LIGHT_UNIFORMS } from "../../../lighting/personal-light/material";
import { reportContentError } from "../../../utils/utils";
import { textureFileOf } from "../../../utils/render/material";
import { ditherGLSL } from "../../../vfx/material";
import { CITY_BIOME_ID } from "../../constants";
import { Biome, MaterialData, Region, RiverbedMaterial } from "../../types";
import commonShader from "../common.glsl";
import { FREEWAY_CORRIDOR_INNER, FREEWAY_CORRIDOR_OUTER, RIVER_BED_FADE_INSET, RIVER_BED_FULL_INSET, RIVER_BED_UNDERWATER_FADE } from "../constants";
import { glslFloat } from "../utils";
import { LOD_FADE_DEFINE, LOD_FADE_UNIFORM, FAR_FADE_DEFINE, FAR_FADE_UNIFORM, WIREFRAME_DEFINE, WIREFRAME_FADE, SKIRT_TINT_GLSL, SKIRT_TINT_UNIFORM, skirtTintUniform, TUNNEL_ROCK_GLSL, BLEND_FIELDS_CLAMPED_UNIFORM, LOD_BLUR_GLSL } from "../material";
import { ENTRANCE_FADE_UNIFORM, ENTRANCE_PATCH_DEFINE, TERRAIN_HOLES_DEFINE, TERRAIN_HOLE_UNIFORMS } from "../terrain-holes/material";
import { PATCH_GROUND_SHARE } from "../terrain-holes/constants";
import { roadBearingBiomeIds } from "../../../generation/registry";
import type { BiomeMixInput } from "./types";
import { BIOME_WEIGHT_VISIBLE } from "./constants";
import { TERRAIN_FRAGMENT_DECLARATIONS_GLSL, TERRAIN_SNOW_GLSL, POINT_LIGHTS_GLSL } from "./material";

/** cos of a slope in degrees as a GLSL literal: compared against the world normal's y. */
const cosDegGLSL = (deg: number): string => Math.cos((deg * Math.PI) / 180).toFixed(6);

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
  /** The slots whose biome has a material of its own (one without draws its region's base, or nothing). */
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
    // Its paint alone: two beds yielding differently still share a sample.
    const key = JSON.stringify({ texture: bed.texture, saturation: bed.saturation, tint: bed.tint });
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

/** A colour call's gate, the same for the whole 2×2 pixel quad (common.glsl `quadGate`): a biome wall's
 *  feather edge gated per pixel traced a dotted line of wrong-mip texels. The extra pixels carry weight 0,
 *  so the colour is unchanged; the cost is one pixel ring per edge. */
const quadGate = (weight: string, threshold = "0.0"): string => `quadGate(${weight}, ${threshold})`;

/** The per-pixel biome cross-fade, in two passes. WEIGHTS: each tier claims `remaining × weight`, softer
 *  tiers split the rest, and a visible slot's weight goes to its region BASE and its own frag by presence
 *  (a biome with no <Material> of its own is all base: the salt flats; one with no region base is all frag).
 *  COLOURS: each base and each frag CALLED ONCE, with its summed weight. A slot's colour is
 *  mix(base, frag, presence), linear in both, so the sum is the per-slot mix regrouped; but a base shared by
 *  several slots used to be called (and, function calls being inlined, compiled) once per slot — 8 base call
 *  sites for 4 bases in each of the three terrain programs (MEASURED, Firefox: their links 683/663/592 →
 *  574/571/479 ms of blocked main thread) — and a base fully covered by its biome's frag still ran. The city's frag is kept in `cityColor` for the road
 *  corridor (cityCorridorGLSL), which used to call it a second time. */
const biomeMixGLSL = (input: BiomeMixInput, citySlot: number): string => {
  const { biomes, baseFunctionOf, slotRegions, slotsWithMaterial, drawnSlots } = input;
  const halfOf = (k: number) => input.slotHalves?.[k] ?? 1;
  const baseOfSlot = (k: number): string | null => (slotRegions ? baseFunctionOf[slotRegions[k]] : null);
  const bases = [...new Set(drawnSlots.map(baseOfSlot).filter((b): b is string => b !== null))];
  const baseW = (base: string) => `baseW${bases.indexOf(base)}`;
  const frags = drawnSlots.filter((k) => slotsWithMaterial.includes(k));
  const attribute = (k: number): string => {
    const base = baseOfSlot(k);
    if (base && !slotsWithMaterial.includes(k)) return `${baseW(base)} += W${k};`;
    if (!base) return `fragW${k} += W${k};`;
    return `float p${k} = smoothstep(0.0, 1.0, ${slotOf("vBiomePresence", k)});
          if (p${k} > 0.001) { ${baseW(base)} += W${k} * (1.0 - p${k}); fragW${k} += W${k} * p${k}; } else ${baseW(base)} += W${k};`;
  };
  const tiers = crispnessTiers(drawnSlots, halfOf);
  const weights = tiers.map(
    (tier, t) => `{
        ${tier.map((k) => `float e${k} = 1.0 + fieldBlur * ${glslFloat(1 / halfOf(k))}; float w${k} = smoothstep(-e${k}, e${k}, ${slotOf("vBiomeSdf", k)});`).join("\n        ")}
        float tierSum = ${tier.map((k) => `w${k}`).join(" + ")};
        float tierScale = remaining * (tierSum >= 1.0 ? 1.0 / tierSum : 1.0);
        ${tier
          .map(
            (k) => `float W${k} = w${k} * tierScale;
        if (W${k} > ${BIOME_WEIGHT_VISIBLE}) {
          weightSum += W${k};
          ${attribute(k)}
        }`,
          )
          .join("\n        ")}
        ${t < tiers.length - 1 ? "remaining *= max(0.0, 1.0 - tierSum);" : ""}
      }`,
  );
  const fragColor = (k: number): string =>
    k === citySlot
      ? `if (${quadGate(`fragW${k}`)} || vDistanceToRoadCenter < ${glslFloat(FREEWAY_CORRIDOR_OUTER)}) { ${biomes[k].name}_frag(); cityColor = gl_FragColor; }
      blended += cityColor * fragW${k};`
      : `if (${quadGate(`fragW${k}`)}) { ${biomes[k].name}_frag(); blended += gl_FragColor * fragW${k}; }`;
  return [
    bases.map((b) => `float ${baseW(b)} = 0.0;`).join(" "),
    frags.map((k) => `float fragW${k} = 0.0;`).join(" "),
    ...weights,
    ...bases.map((b) => `if (${quadGate(baseW(b))}) { ${b}(); blended += gl_FragColor * ${baseW(b)}; }`),
    citySlot >= 0 ? "vec4 cityColor = vec4(0.0);" : "",
    ...frags.map(fragColor),
  ].join("\n      ");
};

/** The riverbed groups' weights `bedW<g>`, from the RIVERBED's own slot distances (vRiverbedSdf — the
 *  biome walls' feathers floored at RIVER_BED_TEXTURE_HALF) in the same crispness tiers as the ground:
 *  by the ground's own weights the bed's texture switched within 1u beside the crisp city. `bedYield<y>`
 *  sums the weights of the slots yielding by slope range y (`yieldOf`: −1 for a bed that never yields). */
const riverbedWeightsGLSL = (slotCount: number, bedGroupOf: number[], bedHalves: number[] | undefined, yieldOf: number[]): string => {
  const slots = Array.from({ length: slotCount }, (_, k) => k);
  const bedHalfOf = (k: number) => bedHalves?.[k] ?? 1;
  const tiers = crispnessTiers(slots, bedHalfOf);
  return tiers
    .map(
      (tier, t) => `{
        ${tier.map((k) => `float re${k} = 1.0 + fieldBlur * ${glslFloat(1 / bedHalfOf(k))}; float r${k} = smoothstep(-re${k}, re${k}, ${slotOf("vRiverbedSdf", k)});`).join("\n        ")}
        float bedTierSum = ${tier.map((k) => `r${k}`).join(" + ")};
        float bedTierScale = bedRemaining * (bedTierSum >= 1.0 ? 1.0 / bedTierSum : 1.0);
        ${tier.map((k) => `bedW${bedGroupOf[k]} += r${k} * bedTierScale;${yieldOf[k] >= 0 ? ` bedYield${yieldOf[k]} += r${k} * bedTierScale;` : ""}`).join("\n        ")}
        ${t < tiers.length - 1 ? "bedRemaining *= max(0.0, 1.0 - bedTierSum);" : ""}
      }`,
    )
    .join("\n        ");
};

/** River BED and BANKS: the riverbed from the channel out to the bank's edge, fading into the ground
 *  beyond over RIVER_BED_BLEND_WIDTH (the Water system draws the surface) — each biome's own bed,
 *  cross-faded softly across biome walls (riverbedWeightsGLSL), darkened by the ONE bed shade
 *  (common.glsl bedShade). It yields where a road-bearing biome's road field says pavement (`pavedSlots`:
 *  its streets', and a quay's, asphalt, curb and 4u sidewalk band, crisp: the sidewalk along a river is as
 *  wide as along any road) and on steep banks of a biome whose riverbed declares `yieldSlope` (`slotYields`: a
 *  mountainside keeps its rock) — on the BANKS only: under the water the slope rule fades out over
 *  RIVER_BED_UNDERWATER_FADE of depth (a mountain channel's steep walls showed the snow through the water).
 *  A bed with none never yields to slope: grass, dunes and snow cut into the band in wedges reaching the
 *  water wherever a bank steepened (Evan, screenshot at (-8900, 1100)). */
const riverBedGLSL = (
  bedKeys: string[],
  bedGroupOf: number[],
  bedHalves: number[] | undefined,
  pavedSlots: number[],
  slotYields: ([number, number] | undefined)[],
): string => {
  const ranges: [number, number][] = [];
  const yieldOf = slotYields.map((y) => {
    if (!y) return -1;
    const at = ranges.findIndex((r) => r[0] === y[0] && r[1] === y[1]);
    return at >= 0 ? at : ranges.push(y) - 1;
  });
  const pavement = pavedSlots.length > 0 ? `min(${pavedSlots.map((k) => `smoothstep(-1.0, 1.0, ${slotOf("vBiomeSdf", k)})`).join(" + ")}, 1.0)` : "0.0";
  const steep = ranges.length > 0 ? ranges.map(([start, end], y) => `(1.0 - smoothstep(${cosDegGLSL(end)}, ${cosDegGLSL(start)}, normalize(vWorldNormal).y)) * min(bedYield${y}, 1.0)`).join(" + ") : "0.0";
  return `if (vRiverBedDistance < RIVER_BED_REACH) {
        vec2 bedUV = vWorldUv;
        ${bedKeys.map((_, g) => `float bedW${g} = 0.0;`).join(" ")}
        float bedRemaining = 1.0;
        ${ranges.map((_, y) => `float bedYield${y} = 0.0;`).join(" ")}
        ${riverbedWeightsGLSL(bedGroupOf.length, bedGroupOf, bedHalves, yieldOf)}
        vec3 bed = vec3(0.0);
        float bedSum = 0.0;
        ${bedKeys.map((_, g) => `if (${quadGate(`bedW${g}`, glslFloat(BIOME_WEIGHT_VISIBLE))}) { bed += ${riverbedSampleGLSL(g, bedKeys)} * bedW${g}; bedSum += bedW${g}; }`).join("\n        ")}
        vec4 riverColor = vec4(bedShade(bed / max(bedSum, 1e-4), vWorldPosWrapped, vUnderwaterDepth), 1.0);
        // The LOD blur widens the fade past the reach, where this branch cuts it: whole by the reach. A capped
        // bank (capRiverBed) and a mouth sit EXACTLY at the reach, so the branch flipped pixel by pixel on
        // float noise there and painted a part of the bed in every other pixel: the shimmer on far banks.
        float riverBlend = max(blurStep(RIVER_BED_REACH - ${glslFloat(RIVER_BED_FULL_INSET)}, RIVER_BED_REACH - ${glslFloat(RIVER_BED_FADE_INSET)}, vRiverBedDistance), smoothstep(RIVER_BED_REACH - ${glslFloat(RIVER_BED_FADE_INSET)}, RIVER_BED_REACH, vRiverBedDistance));
        float pavement = ${pavement} * (1.0 - blurStep(ROAD_HALF_WIDTH + 4.0, ROAD_HALF_WIDTH + 5.0, vDistanceToRoadCenter));
        float bedSteep = (${steep})
          * (1.0 - smoothstep(0.0, ${glslFloat(RIVER_BED_UNDERWATER_FADE)}, vUnderwaterDepth));
        gl_FragColor = mix(riverColor, gl_FragColor, max(max(riverBlend, pavement), bedSteep));
      }`;
};

/** Freeways OUTSIDE the city (the inter-city runs, the outer half of every belt) painted over the
 *  finished biome mix and riverbed with the CITY'S OWN frag (`cityColor`, which the mix computes wherever the
 *  corridor reaches), so a run is the same asphalt, curb and lane paint as the belt it merges into (inside
 *  one biome's frag it would fade with that biome's presence). Not gated on being outside the city: on the
 *  wall the 2u material feather would mix the neighbor's ground into the belt's centerline. Empty without
 *  a city biome (or one without a material). */
const cityCorridorGLSL = (hasCity: boolean): string =>
  !hasCity
    ? ""
    : `if (vDistanceToRoadCenter < ${glslFloat(FREEWAY_CORRIDOR_OUTER)}) {
        float corridor = 1.0 - blurStep(${glslFloat(FREEWAY_CORRIDOR_INNER)}, ${glslFloat(FREEWAY_CORRIDOR_OUTER)}, vDistanceToRoadCenter);
        gl_FragColor = mix(gl_FragColor, cityColor, corridor);
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
  // uNightBlend, the lamp-grid, the holes' and the personal light's uniforms are SHARED objects so every
  // terrain material dims, cuts and lights in lockstep.
  const combinedUniforms: any = { uNightBlend: NIGHT_BLEND_UNIFORM, ...LAMP_GRID_UNIFORMS, [SKIRT_TINT_UNIFORM]: skirtTintUniform, ...TERRAIN_HOLE_UNIFORMS, ...PERSONAL_LIGHT_UNIFORMS, [ENTRANCE_FADE_UNIFORM]: { value: 0 }, [BLEND_FIELDS_CLAMPED_UNIFORM]: { value: 0 } };

  // The scene point lights' struct/array uniforms are written by the renderer (material.lights),
  // so they must NOT go through the scalar declaration generator; nor the declared-by-hand ones.
  Object.assign(combinedUniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.lights));
  const UNDECLARED_KEYS = new Set([...Object.keys(THREE.UniformsLib.lights), ...Object.keys(TERRAIN_HOLE_UNIFORMS), ...Object.keys(PERSONAL_LIGHT_UNIFORMS), ENTRANCE_FADE_UNIFORM, BLEND_FIELDS_CLAMPED_UNIFORM]);

  if (riverTexture) {
    combinedUniforms.rivertexture = { value: riverTexture };
  }

  const { bedKeys, bedGroupOf } = groupRiverbeds(biomes.length, slotRiverbeds);
  for (const [file, texture] of riverbedTextures) combinedUniforms[riverbedUniformOf(file)] = { value: texture };

  const { functions, baseFunctionOf, slotsWithMaterial } = await collectFragFunctions(biomes, regions, combinedUniforms);
  const drawnSlots = biomes.map((_, k) => k).filter((k) => slotsWithMaterial.includes(k) || !!(slotRegions && baseFunctionOf[slotRegions[k]]));
  const cityIdx = biomes.findIndex((b) => b.id === CITY_BIOME_ID);
  const citySlot = cityIdx >= 0 && slotsWithMaterial.includes(cityIdx) ? cityIdx : -1;
  const biomeMix = biomeMixGLSL({ biomes, slotsWithMaterial, drawnSlots, baseFunctionOf, slotRegions, slotHalves }, citySlot);
  const cityCorridor = cityCorridorGLSL(citySlot >= 0);

  const fragmentShader = `
    ${varyingDeclarations.join("\n    ")}

    ${Object.entries(combinedUniforms)
      .filter(([name]) => !UNDECLARED_KEYS.has(name))
      .map(([name, uniform]) => uniformDeclarationOf(name, uniform as { value: any }))
      .join("\n    ")}

    ${TERRAIN_FRAGMENT_DECLARATIONS_GLSL}

    ${commonShader}

    ${LOD_BLUR_GLSL}

    ${TUNNEL_ROCK_GLSL}

    ${functions.join("\n\n    ")}

    void main() {
      // A chunk mid LOD swap keeps only its dither share (world/terrain/lod-swaps/LodSwapper.ts); a settled chunk's range keeps every pixel.
      #ifdef ${LOD_FADE_DEFINE}
      if (lodFadeDiscards(${LOD_FADE_UNIFORM})) discard;
      #endif
      // The far chunks dissolve into the sky before the far plane (world/shaders/material.ts).
      #ifdef ${FAR_FADE_DEFINE}
      if (farFadeDiscards(vFarDistance, ${FAR_FADE_UNIFORM})) discard;
      #endif
      #ifdef ${WIREFRAME_DEFINE}
      if (vSkirt > 0.0 || farFadeDiscards(vFarDistance, vec2(${glslFloat(WIREFRAME_FADE[0])}, ${glslFloat(WIREFRAME_FADE[1])}))) discard;
      #endif
      // The tunnels' openings and skirt masks, by ABSOLUTE position (world/shaders/terrain-holes/store.ts).
      #ifdef ${TERRAIN_HOLES_DEFINE}
      if (terrainHoleDiscards(vWorldPosAbs, vSkirt)) discard;
      #endif
      // The entrance patch draws by the fade's complement and never a skirt. On the GROUND (rock share
      // under PATCH_GROUND_SHARE) it draws exactly the pixels its mouth's cut gives up, the terrain the
      // rest — one per-pixel rule on both sides. A WALL pixel is never cut: past the footprint's end and
      // above the cut's ceiling the walls have no terrain behind them, and cutting them opened a ring of
      // holes around every tube at its mouth section's inner end.
      #ifdef ${ENTRANCE_PATCH_DEFINE}
      if (vSkirt > 0.0 || entranceFadeDiscards()) discard;
      if (vEntranceRock.x < ${glslFloat(PATCH_GROUND_SHARE)} && !mouthCutsHere(vWorldPosAbs)) discard;
      #endif
      // Paint edges soften with the LOD rings' vertex spacing (world/shaders/material.ts); the biome fields
      // only where this chunk left them unclamped.
      lodBlur = lodBlurAt(vFarDistance);
      float fieldBlur = lodBlur * (1.0 - ${BLEND_FIELDS_CLAMPED_UNIFORM});
      vec4 blended = vec4(0.0);
      float weightSum = 0.0;
      float remaining = 1.0;
      ${biomeMix}
      // At a vertex the own biome's sdf is ≥ 0 (weight ≥ 0.5); inside a coarse triangle only the far
      // LODs' clamped fields keep the sum from vanishing (LODLevel.clampBlendFields) — the max is a guard.
      gl_FragColor = blended / max(weightSum, 1e-4);

      ${riverBedGLSL(bedKeys, bedGroupOf, bedSlotHalves, biomes.flatMap((b, k) => (roadBearingBiomeIds().includes(b.id) ? [k] : [])), slotRiverbeds.map((bed) => bed?.yieldSlope))}

      ${cityCorridor}

      ${TERRAIN_SNOW_GLSL}

      ${nightDimGLSL("gl_FragColor.rgb")}

      #ifdef ${ENTRANCE_PATCH_DEFINE}
      // The patch IS the terrain on the ground and the cave's rock under it, lit as the tunnel is: the
      // rock share carries its own night dim (tunnelShade dims only what daylight reaches), after the
      // ground's.
      {
        vec3 patchNormal = normalize(vWorldNormal);
        vec3 rock = tunnelShade(tunnelRockColor(vWorldPosAbs, patchNormal), patchNormal, vEntranceRock.y, vWorldPosAbs - cameraPosition);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, rock, vEntranceRock.x);
      }
      #endif

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
