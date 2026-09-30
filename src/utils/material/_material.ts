import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL } from "../../lighting/dayNight";
import { ditherGLSL } from "../../vfx/dither";
import { LAMP_GRID_UNIFORMS, lampGlowAccumGLSL } from "../../lighting/lampGlow";
import { Biome, MaterialData, Region, RiverbedMaterial } from "../../world/types";
import { CITY_BIOME_ID } from "../../world/constants";
import commonShader from "../../world/shaders/common.glsl";
import { FREEWAY_CORRIDOR_INNER, FREEWAY_CORRIDOR_OUTER, glslFloat } from "../../world/shaders/constants";

/** Below this a biome's fragment function is skipped: its color could not be seen. */
const BIOME_WEIGHT_VISIBLE = 0.002;

/** The file each loaded texture came from — what tells two same-named uniforms apart. */
const TEXTURE_FILES = new WeakMap<THREE.Texture, string>();

const reportShaderError = (message: string): void => {
  if (process.env.NODE_ENV === "production") console.error(`[terrain material] ${message}`);
  else throw new Error(`[terrain material] ${message}`);
};

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
  value instanceof THREE.Texture ? `texture ${TEXTURE_FILES.get(value) ?? value.uuid}` : JSON.stringify(value);

export namespace _material {
  export const loadTextures = async (filenames: string[]): Promise<THREE.Texture[]> => {
    const textureLoader = new THREE.TextureLoader();
    return Promise.all(
      filenames.map(
        (filename) =>
          new Promise<THREE.Texture>((resolve, reject) =>
            textureLoader.load(
              process.env.PUBLIC_URL + "/textures/" + filename,
              (tex) => {
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                TEXTURE_FILES.set(tex, filename);
                resolve(tex);
              },
              undefined,
              reject,
            ),
          ),
      ),
    );
  };

  /** A biome/region material from its fragment shader and its sampler uniforms (uniform name →
   *  filename under public/textures/, in declaration order). */
  export const fromShader =
    (fragmentShader: string, textures: Readonly<Record<string, string>> = {}) =>
    async (): Promise<MaterialData> => {
      const names = Object.keys(textures);
      const loaded = await loadTextures(names.map((n) => textures[n]));
      return { uniforms: Object.fromEntries(names.map((n, i) => [n, { value: loaded[i] }])), fragmentShader };
    };

  const getUniformDeclaration = (name: string, uniform: { value: any }): string => {
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
      /** Per slot, the index into `regions` of the biome's region (its base material). */
      slotRegions?: number[];
    } = {},
  ): Promise<THREE.ShaderMaterial> => {
    const { riverTexture, slotRiverbeds = [], riverbedTextures = new Map(), varyingDeclarations = [], defines = {}, slotHalves, slotRegions } = options;
    // uNightBlend and the lamp-grid uniforms are SHARED objects so every terrain material dims in lockstep.
    const combinedUniforms: any = { uNightBlend: NIGHT_BLEND_UNIFORM, ...LAMP_GRID_UNIFORMS };

    // The scene point lights shade the otherwise-unlit terrain (a per-fragment NUM_POINT_LIGHTS
    // lambert loop). Their uniforms are struct/array uniforms the renderer writes (material.lights);
    // they must NOT go through the scalar declaration generator below.
    Object.assign(combinedUniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.lights));
    const LIGHTS_UNIFORM_KEYS = new Set(Object.keys(THREE.UniformsLib.lights));

    if (riverTexture) {
      combinedUniforms.rivertexture = { value: riverTexture };
    }

    // RIVERBED GROUPS: slots with the same bed share one weight and one texture sample (the
    // domain's river texture is group 0). A sampler per distinct file, never per biome — the
    // shader is already near the 16 texture units.
    const bedKeys: string[] = ["domain"];
    const bedGroupOf: number[] = biomes.map((_, k) => {
      const bed = slotRiverbeds[k];
      if (!bed) return 0;
      const key = JSON.stringify(bed);
      let g = bedKeys.indexOf(key);
      if (g < 0) g = bedKeys.push(key) - 1;
      return g;
    });
    const bedUniformOf = (file: string) => `riverbed_${file.replace(/[^A-Za-z0-9]/g, "_")}`;
    for (const [file, texture] of riverbedTextures) combinedUniforms[bedUniformOf(file)] = { value: texture };
    const bedSample = (g: number): string => {
      if (g === 0) return "texture2D(rivertexture, bedUV).rgb";
      const bed = JSON.parse(bedKeys[g]) as RiverbedMaterial;
      const tint = bed.tint ?? [1, 1, 1];
      const vec = (v: number[]) => `vec3(${v.map((c) => c.toFixed(4)).join(", ")})`;
      return `(mix(vec3(dot(texture2D(${bedUniformOf(bed.texture)}, bedUV).rgb, vec3(0.299, 0.587, 0.114))), texture2D(${bedUniformOf(bed.texture)}, bedUV).rgb, ${(bed.saturation ?? 1).toFixed(4)}) * ${vec(tint)})`;
    };

    const fragmentFunctions: string[] = [];
    const uniformOwners = new Map<string, string>();
    const chunks: { owner: string; source: string }[] = [];
    const addChunk = (m: MaterialData, name: string): void => {
      mergeUniforms(combinedUniforms, uniformOwners, m.uniforms, name);
      const source = toFragFunction(m.fragmentShader, name);
      fragmentFunctions.push(source);
      chunks.push({ owner: name, source });
    };

    // Region BASE materials: one function per region that has one.
    const baseFn: (string | null)[] = [];
    for (const region of regions) {
      if (!region.getMaterial) {
        baseFn.push(null);
        continue;
      }
      const name = `${region.name}_base_frag`;
      addChunk(await region.getMaterial(), name);
      baseFn.push(name);
    }

    const withMaterial: number[] = [];
    for (let k = 0; k < biomes.length; k++) {
      const biome = biomes[k];
      if (!biome.getMaterial) continue;
      addChunk(await biome.getMaterial(), `${biome.name}_frag`);
      withMaterial.push(k);
    }
    assertUniqueFileScopeNames(chunks);

    // A biome's color: its region base faded into its own frag by presence.
    const biomeColor = (k: number): string => {
      const base = slotRegions ? baseFn[slotRegions[k]] : null;
      if (!base) return `${biomes[k].name}_frag(); vec4 c${k} = gl_FragColor;`;
      return `float p${k} = smoothstep(0.0, 1.0, ${slotOf("vBiomePresence", k)});
          ${base}(); vec4 c${k} = gl_FragColor;
          if (p${k} > 0.001) { ${biomes[k].name}_frag(); c${k} = mix(c${k}, gl_FragColor, p${k}); }`;
    };

    // Tiers of equal half-width, crispest first (mirrors combineSlotWeights).
    const halfOf = (k: number) => slotHalves?.[k] ?? 1;
    const tiers: number[][] = [];
    for (const k of [...withMaterial].sort((a, b) => halfOf(a) - halfOf(b))) {
      const last = tiers[tiers.length - 1];
      if (last && halfOf(last[0]) === halfOf(k)) last.push(k);
      else tiers.push([k]);
    }
    const blendCalls = tiers.map(
      (tier, t) => `{
        ${tier.map((k) => `float w${k} = smoothstep(-1.0, 1.0, ${slotOf("vBiomeSdf", k)});`).join("\n        ")}
        float tierSum = ${tier.map((k) => `w${k}`).join(" + ")};
        float tierScale = remaining * (tierSum >= 1.0 ? 1.0 / tierSum : 1.0);
        ${tier
          .map(
            (k) => `if (w${k} * tierScale > ${BIOME_WEIGHT_VISIBLE}) {
          ${biomeColor(k)}
          blended += c${k} * (w${k} * tierScale);
          weightSum += w${k} * tierScale;
          bedW${bedGroupOf[k]} += w${k} * tierScale;
        }`,
          )
          .join("\n        ")}
        ${t < tiers.length - 1 ? "remaining *= max(0.0, 1.0 - tierSum);" : ""}
      }`,
    );

    const cityIdx = biomes.findIndex((b) => b.id === CITY_BIOME_ID);
    const cityCorridor =
      cityIdx >= 0 && withMaterial.includes(cityIdx)
        ? `if (vDistanceToRoadCenter < ${glslFloat(FREEWAY_CORRIDOR_OUTER)}) {
        float corridor = 1.0 - smoothstep(${glslFloat(FREEWAY_CORRIDOR_INNER)}, ${glslFloat(FREEWAY_CORRIDOR_OUTER)}, vDistanceToRoadCenter);
        vec4 ground = gl_FragColor;
        ${biomes[cityIdx].name}_frag();
        gl_FragColor = mix(ground, gl_FragColor, corridor);
      }`
        : "";

    const fragmentShader = `
    ${varyingDeclarations.join("\n    ")}

    ${Object.entries(combinedUniforms)
      .filter(([name]) => !LIGHTS_UNIFORM_KEYS.has(name))
      .map(([name, uniform]) => getUniformDeclaration(name, uniform as { value: any }))
      .join("\n    ")}

    #if NUM_POINT_LIGHTS > 0
      struct PointLight {
        vec3 position;
        vec3 color;
        float distance;
        float decay;
      };
      uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
    #endif

    ${commonShader}

    ${fragmentFunctions.join("\n\n    ")}

    void main() {
      vec4 blended = vec4(0.0);
      float weightSum = 0.0;
      float remaining = 1.0;
      ${bedKeys.map((_, g) => `float bedW${g} = 0.0;`).join(" ")}
      ${blendCalls.join("\n      ")}
      // At a vertex the own biome's sdf is ≥ 0 (weight ≥ 0.5); inside a coarse triangle only the far
      // LODs' clamped fields keep the sum from vanishing (LODLevel.clampBlendFields) — the max is a guard.
      gl_FragColor = blended / max(weightSum, 1e-4);

      // River BED and BANKS: the riverbed from the channel out to the bank's edge, with a SHORT fade
      // into the ground beyond (the Water system draws the surface) — each biome's own bed (its
      // <Material riverbed>, else the domain's river texture), cross-faded by the same weights as
      // the ground, so a bed changes across a biome wall with no edge. In a city the band ends at
      // the quay's river-side sidewalk (riverBedDistance: a long blend reads as sidewalk smearing
      // into riverbed, and the meandered edge leaves plaza between them).
      if (vRiverBedDistance < RIVER_BED_REACH) {
        vec2 bedUV = fract(vWorldUv);
        vec3 bed = vec3(0.0);
        float bedSum = 0.0;
        ${bedKeys.map((_, g) => `if (bedW${g} > ${BIOME_WEIGHT_VISIBLE}) { bed += ${bedSample(g)} * bedW${g}; bedSum += bedW${g}; }`).join("\n        ")}
        vec4 riverColor = vec4(bed / max(bedSum, 1e-4), 1.0);
        riverColor.rgb *= mix(vec3(0.72, 0.7, 0.66), vec3(1.0), smoothstep(RIVER_HALF_WIDTH * 0.5, RIVER_HALF_WIDTH * 1.3, vRiverBedDistance));
        // The bed covers the bank out to its edge, EXCEPT where the CITY's road field says pavement:
        // a quay's asphalt, curb and 4u sidewalk band stay, so the sidewalk along a river is the same
        // constant width as along any other road. Off the city the freeway corridor below paints the
        // road over the bed (its curb strip then fades straight into the bed, not into grass).
        float riverBlend = smoothstep(RIVER_BED_REACH - 3.0, RIVER_BED_REACH - 1.0, vRiverBedDistance);
        float pavement = ${cityIdx >= 0 ? `smoothstep(-1.0, 1.0, ${slotOf("vBiomeSdf", cityIdx)})` : "0.0"} * (1.0 - smoothstep(ROAD_HALF_WIDTH + 4.0, ROAD_HALF_WIDTH + 5.0, vDistanceToRoadCenter));
        gl_FragColor = mix(riverColor, gl_FragColor, max(riverBlend, pavement));
      }

      // Freeways OUTSIDE the city — the inter-city runs and the outer half of every belt — are
      // painted HERE, over the finished biome mix and the riverbed, with the CITY'S OWN road shader:
      // city_frag reads the same normalized road field and freeway varyings the city's arterials
      // use, so a run is the same asphalt, curb and lane paint as the belt it merges into (painted
      // inside one biome's frag a run would fade with that biome's presence — a green road with faint
      // lane lines beside the city). The corridor ends at the curb strip's outer edge (8
      // street units from the centerline) and is NOT gated on being outside the city: on the wall
      // itself the 2u material feather would mix the neighbor's ground into the belt's centerline as
      // a thin green line. Inside the city it re-applies the city's own frag.
      ${cityCorridor}

      ${nightDimGLSL("gl_FragColor.rgb")}

      // Lamp glow after the night dim so lamps brighten the ground; ABSOLUTE
      // position — the wrapped one aliased the glow onto the wrong chunks.
      ${lampGlowAccumGLSL("vWorldPosAbs")}
      gl_FragColor.rgb += lampGlowSum * 0.25;

      // Lambert from the scene point lights.
      // pointLights[i].position is VIEW-space, color premultiplied by intensity.
      // ABSOLUTE position (wrapped lit the wrong chunks); gated on the night
      // blend because every scene point light follows it — by day this is dead work.
      #if NUM_POINT_LIGHTS > 0
      if (uNightBlend > 0.001) {
        vec3 plViewPos = (viewMatrix * vec4(vWorldPosAbs, 1.0)).xyz;
        vec3 plViewNormal = normalize((viewMatrix * vec4(vWorldNormal, 0.0)).xyz);
        vec3 pointLightSum = vec3(0.0);
        for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
          // Parked pool lights have color 0 — uniform-coherent skip.
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
      #endif

      // Slow gradients band into rings at 8 bits without the dither.
      ${ditherGLSL("gl_FragColor.rgb")}
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
}
