import * as THREE from "three";
import { CAMERA_FAR } from "../../player/constants";
import { FAR_FADE_FRACTION, MATERIAL_LOD_BLUR } from "./constants";
import { _curvature, _quantization } from "../../vfx/material";
import { LOD_LEVELS } from "../terrain/lod/constants";
import { glslFloat } from "./utils";
import { NIGHT_GROUND_DIM } from "../../lighting/day-night/constants";
import { FLASHLIGHT_DIR_UNIFORM, FLASHLIGHT_UNIFORM, PERSONAL_LIGHT_UNIFORM } from "../../lighting/personal-light/material";

/**
 * The ground's FAR FADE: terrain and water dither out over the last FAR_FADE_FRACTION of the camera's far
 * distance (the same screen-door pattern as every object fade, vfx/material.ts), so the horizon dissolves into
 * the sky instead of being cut by the far plane. The range follows the LIVE camera.far (setFarFade, every
 * frame from TerrainRenderer). Measured as the horizontal camera distance, the one world curvature uses. The
 * fraction is FAR_FADE_FRACTION (shaders/constants.ts).
 */

export const FAR_FADE_DEFINE = "TERRAIN_FAR_FADE";
export const FAR_FADE_UNIFORM = "uFarFade";

/** A WIREFRAME terrain (<Terrain wireframe>, world/terrain/material.ts) draws no skirts, and its lines
 *  dither out over WIREFRAME_FADE (horizontal units, by this same far fade): the far LOD rings' lines
 *  otherwise pile into a solid band at the horizon. */
export const WIREFRAME_DEFINE = "TERRAIN_WIREFRAME";
export const WIREFRAME_FADE: readonly [number, number] = [200, 400];

/** [start, end] of the fade, shared by every terrain and water material. */
export const FAR_FADE_UNIFORMS = { [FAR_FADE_UNIFORM]: { value: new THREE.Vector2() } };

export const setFarFade = (cameraFar: number): void => {
  FAR_FADE_UNIFORMS[FAR_FADE_UNIFORM].value.set(cameraFar * (1 - FAR_FADE_FRACTION), cameraFar);
};
setFarFade(CAMERA_FAR);

/** Vertex stage: the horizontal camera distance of a pre-curvature view-space position. */
export const FAR_DISTANCE_GLSL = /* glsl */ `
  float farFadeDistance(vec3 viewPos) {
    vec3 up = viewMatrix[1].xyz;
    return length(viewPos - up * dot(viewPos, up));
  }
`;

/** Fragment stage; needs SCREEN_DOOR_GLSL declared before it. Eased like the sprites' far fade. */
export const FAR_FADE_GLSL = /* glsl */ `
  bool farFadeDiscards(float distance, vec2 range) {
    float visibility = smoothstep(0.0, 1.0, clamp((range.y - distance) / max(range.y - range.x, 1e-3), 0.0, 1.0));
    return visibility < 1.0 && visibility <= screenDoorThreshold(gl_FragCoord.xy);
  }
`;

/**
 * THE shared vertex stage of every chunk-relative custom program (the terrain, the tunnels, the snow
 * sheet, the rocks, the particles): wrapped chunk origin + local offset, quantized, projected through
 * `modelViewMatrix[3]` (the CPU-resolved view-space origin), curved — never an absolute float32 world
 * coordinate (CLAUDE.md "Coordinate precision"). It writes the wrapped/absolute position and world
 * normal varyings. A program including it carries quantization and curvature itself and must not be
 * patched again (Dressing.tsx selfPatchedMaterial).
 */

export const CHUNK_PROJECTION_VARYINGS = ["varying vec3 vWorldPosWrapped;", "varying vec3 vWorldPosAbs;", "varying vec3 vWorldNormal;", "varying float vFarDistance;"];

/** Needs the WORLD_WRAP define and the uGridSize / uGridGrowth / uCurveStart / uCurveK uniforms (shared objects). */
export const CHUNK_PROJECTION_GLSL = /* glsl */ `
${_quantization.QUANTIZE_GLSL}
${_curvature.CURVE_GLSL}
${FAR_DISTANCE_GLSL}
${CHUNK_PROJECTION_VARYINGS.join("\n")}

vec4 projectChunkLocal(vec3 localPos, vec3 localNormal) {
  vec3 chunkOrigin = modelMatrix[3].xyz;
  vec3 wrapOrigin = vec3(mod(chunkOrigin.x, WORLD_WRAP), chunkOrigin.y, mod(chunkOrigin.z, WORLD_WRAP));
  vec3 localWorld = mat3(modelMatrix) * localPos;
  vec3 worldPos = quantizeWorldPos(wrapOrigin + localWorld, modelViewMatrix[3].xyz + mat3(viewMatrix) * localWorld);
  vWorldPosWrapped = worldPos;
  // Unwrapped: ONLY for comparing against CPU-side absolute positions (lamp grid, point lights, the
  // terrain holes). Never for tiling, quantization or fwidth() guards.
  vWorldPosAbs = chunkOrigin + localWorld;
  vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
  vec3 viewPos = modelViewMatrix[3].xyz + mat3(viewMatrix) * (worldPos - wrapOrigin);
  vFarDistance = farFadeDistance(viewPos);
  return projectionMatrix * vec4(curveViewPos(viewPos), 1.0);
}
`;

/** The uniform objects the projection reads, shared so everything bends and snaps in lockstep. */
export const CHUNK_PROJECTION_UNIFORMS = {
  uGridSize: _quantization.uniforms.uGridSize,
  uGridGrowth: _quantization.uniforms.uGridGrowth,
  uCurveStart: _curvature.uniforms.uCurveStart,
  uCurveK: _curvature.uniforms.uCurveK,
};

/**
 * The terrain material's LOD BLUR: every narrow paint edge (the biome walls' feathers, the city's road
 * bands, the riverbed's edge, the freeway corridor) widens with the camera distance in step with the
 * LOD rings' vertex spacing. Those edges are thresholds on fields the GPU interpolates LINEARLY between
 * vertices, so on a coarse ring a crisp edge draws the triangulation itself (sawtooth roads, zigzag
 * walls); softened over about half a vertex spacing, it blurs instead.
 *
 * `lodBlur` (world units, a fragment-stage global the biome frags read) is a piecewise-linear ramp of the
 * horizontal camera distance: 0 at the player, MATERIAL_LOD_BLUR × LOD1's spacing halfway out its ring,
 * then MATERIAL_LOD_BLUR × each ring's spacing at its inner edge. A ramp, not the chunk's own spacing:
 * a per-chunk step would draw every ring border as a line where the edges' softness jumps.
 *
 * The biome fields are the exception: the far LODs CLAMP them (LODLevel.clampBlendFields), so their
 * interpolation is already a cross-fade over one triangle, and widened past ±1 a slot's weight would
 * never saturate (every biome bleeding into every other). Their widening is gated per CHUNK by
 * BLEND_FIELDS_CLAMPED_UNIFORM, written per mesh like the dither range (world/terrain/chunk/utils.ts syncChunkUniforms).
 */

export const BLEND_FIELDS_CLAMPED_UNIFORM = "uBlendFieldsClamped";

const spacingOf = (i: number) => LOD_LEVELS[i].chunkSize / LOD_LEVELS[i].segments;

/** [horizontal distance, blur] knots, ascending. */
const BLUR_KNOTS: [number, number][] = [
  [0, 0],
  [LOD_LEVELS[0].maxDistance / 2, spacingOf(0) * MATERIAL_LOD_BLUR],
  ...LOD_LEVELS.slice(1).map((_, j): [number, number] => [LOD_LEVELS[j].maxDistance, spacingOf(j + 1) * MATERIAL_LOD_BLUR]),
];

const blurRampGLSL = (): string => {
  const [last] = BLUR_KNOTS.slice(-1);
  const segments = BLUR_KNOTS.slice(1).map(
    ([d1, b1], j) => {
      const [d0, b0] = BLUR_KNOTS[j];
      return `if (d < ${glslFloat(d1)}) return mix(${glslFloat(b0)}, ${glslFloat(b1)}, (d - ${glslFloat(d0)}) / ${glslFloat(d1 - d0)});`;
    },
  );
  return `${segments.join("\n    ")}\n    return ${glslFloat(last[1])};`;
};

/** Fragment stage, before the biome frags: the global, its ramp and the widened smoothstep. */
export const LOD_BLUR_GLSL = /* glsl */ `
  uniform float ${BLEND_FIELDS_CLAMPED_UNIFORM};
  float lodBlur = 0.0;
  float lodBlurAt(float d) {
    ${blurRampGLSL()}
  }
  /** smoothstep(e0, e1, x) widened by lodBlur on both sides, about the same midpoint. */
  float blurStep(float e0, float e1, float x) {
    float mid = 0.5 * (e0 + e1);
    float reach = 0.5 * (e1 - e0) + lodBlur;
    return smoothstep(mid - reach, mid + reach, x);
  }
`;

/** LOD cross-fade (world/terrain/lod-swaps/LodSwapper.ts): the per-mesh dither range uniform, and the define that
 *  compiles it into the terrain's discard variant (world/terrain/material.ts createDiscardMaterial). */
export const LOD_FADE_UNIFORM = "uLodFade";
export const LOD_FADE_DEFINE = "TERRAIN_LOD_FADE";

/** A mesh keeps the pixels whose screen-door threshold lies in its [range.x, range.y). The old and
 *  new chunks of a swap hold complementary ranges of this ONE threshold, so each pixel is drawn by
 *  exactly one of them. The same 4×4 Bayer pattern as the objects' spawn fade (vfx/spawn-fade/index.ts).
 *  Needs SCREEN_DOOR_GLSL declared before it (one copy per shader, shared with the far fade). */
export const LOD_FADE_GLSL = /* glsl */ `
  bool lodFadeDiscards(vec2 range) {
    float h = screenDoorThreshold(gl_FragCoord.xy);
    return h < range.x || h >= range.y;
  }
`;

/** Devmode "tint skirts" (DEV_TOGGLES): 1 paints every terrain skirt face magenta, telling a skirt seen
 *  through a chunk seam from any other seam artifact. A shared uniform object, so toggling it is free. */
export const SKIRT_TINT_UNIFORM = "uTintSkirts";
export const skirtTintUniform = { value: 0 };

/** Last in the terrain fragment: vSkirt is the skirt's drop (its depth on the bottom ring, 0 on its top ring and the grid). */
export const SKIRT_TINT_GLSL = `if (${SKIRT_TINT_UNIFORM} > 0.5 && vSkirt > 0.0) gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);`;

/**
 * THE cave rock formula, shared by the cave wall material (objects/underground) and the
 * terrain's ENTRANCE variant: color from position and normal, the terrain's fake sun, dimmed by the
 * daylight to a deep-tunnel ambient, plus the player's PERSONAL LIGHT and the dev FLASHLIGHT
 * (lighting/personal-light/index.ts).
 * Both programs compute identical colors at the vertices the entrance patch and the walls share.
 * Needs `uniform float uNightBlend` declared before it (TUNNEL_LIGHT_GLSL below).
 */

/** Deep in a tunnel the surface keeps this share of its lit color, tinted toward the blue of
 *  light that has bounced its way in — darker than comfortable: torches come later. */
const TUNNEL_AMBIENT = 0.028;
const TUNNEL_AMBIENT_TINT = "vec3(0.62, 0.76, 1.18)";
/** The personal light: this share of the surface color within HEADLAMP_NEAR of the camera, gone by
 *  HEADLAMP_FAR, scaled by the personal-light uniform (0 until the player has stood in the dark). */
const HEADLAMP_STRENGTH = 0.22;
const HEADLAMP_NEAR = 1.5;
const HEADLAMP_FAR = 10;
const HEADLAMP_TINT = "vec3(1.0, 0.96, 0.88)";
/** The flashlight: a cone from the camera along its view, full within FLASHLIGHT_INNER_COS of its
 *  axis, gone at FLASHLIGHT_OUTER_COS (~18° / ~35°), reaching FLASHLIGHT_FAR; surfaces facing it brightest. */
const FLASHLIGHT_STRENGTH = 1.1;
const FLASHLIGHT_INNER_COS = 0.95;
const FLASHLIGHT_OUTER_COS = 0.82;
const FLASHLIGHT_NEAR = 15;
const FLASHLIGHT_FAR = 60;

/** THE light in a tunnel, as a multiplier of a surface's color: the fake sun where daylight reaches (dimmed
 *  by the night with the ground outside), the deep blue ambient where it does not, plus the player's own
 *  light. Shared by the walls (tunnelShade below) and every ACTOR standing in a tunnel
 *  (lighting/material.ts), so a beeble in a cave is lit exactly as the rock beside it. Needs
 *  `uniform float uNightBlend` declared before it; declares the personal light's uniforms (a program
 *  including it must carry PERSONAL_LIGHT_UNIFORMS). */
export const TUNNEL_LIGHT_GLSL = /* glsl */ `
  uniform float ${PERSONAL_LIGHT_UNIFORM};
  uniform float ${FLASHLIGHT_UNIFORM};
  uniform vec3 ${FLASHLIGHT_DIR_UNIFORM};
  /** The player's own light on a tunnel surface where daylight does not reach: the headlamp's share
   *  by distance plus the flashlight's cone. \`toSurface\` is the surface's position from the camera. */
  float tunnelPersonalLight(vec3 normal, float day, vec3 toSurface) {
    float cameraDistance = length(toSurface);
    float lamp = ${HEADLAMP_STRENGTH.toFixed(2)} * ${PERSONAL_LIGHT_UNIFORM} * (1.0 - smoothstep(${HEADLAMP_NEAR.toFixed(1)}, ${HEADLAMP_FAR.toFixed(1)}, cameraDistance));
    vec3 ray = toSurface / max(cameraDistance, 1e-3);
    float beam = ${FLASHLIGHT_STRENGTH.toFixed(2)} * ${FLASHLIGHT_UNIFORM} * smoothstep(${FLASHLIGHT_OUTER_COS.toFixed(2)}, ${FLASHLIGHT_INNER_COS.toFixed(2)}, dot(ray, ${FLASHLIGHT_DIR_UNIFORM}))
      * (1.0 - smoothstep(${FLASHLIGHT_NEAR.toFixed(1)}, ${FLASHLIGHT_FAR.toFixed(1)}, cameraDistance)) * (0.3 + 0.7 * max(dot(normal, -ray), 0.0));
    return (lamp + beam) * (1.0 - day);
  }
  /** The night dim is the DAYLIT term's alone: deep in a tunnel the ambient and the player's light know
   *  nothing of the sky, while a mouth dims with the ground around it (a caller must not dim again).
   *  The sun is common.glsl's fakeSunLight, inlined so a program without common.glsl can light. */
  vec3 tunnelLightFactor(vec3 normal, float daylight, vec3 toSurface) {
    float day = clamp(daylight, 0.0, 1.0);
    float sun = clamp(dot(normalize(normal), normalize(vec3(0.35, 0.9, 0.2))), 0.0, 1.0);
    vec3 lit = vec3((0.6 + 0.4 * sun) * mix(1.0, ${NIGHT_GROUND_DIM.toFixed(3)}, uNightBlend));
    return mix(vec3(${TUNNEL_AMBIENT.toFixed(3)}) * ${TUNNEL_AMBIENT_TINT}, lit, day) + ${HEADLAMP_TINT} * tunnelPersonalLight(normal, day, toSurface);
  }
`;

export const TUNNEL_ROCK_GLSL = /* glsl */ `
  ${TUNNEL_LIGHT_GLSL}
  /** A smooth grain of ~20–30u over the rock. */
  float tunnelRockGrain(vec3 p) {
    return sin(p.x * 0.21 + p.z * 0.17 + sin(p.y * 0.3)) * sin(p.y * 0.31 - p.x * 0.11 + p.z * 0.07);
  }
  /** Wall rock turning to floor as the normal faces up, with grain. The constants are LINEAR and
   *  neither program encodes its output (the terrain reads its sRGB textures raw), so the color is
   *  encoded here, like the ground beside it. */
  vec3 tunnelRockColor(vec3 worldAbs, vec3 normal) {
    float up = smoothstep(0.2, 0.85, normal.y);
    vec3 base = mix(vec3(0.4, 0.4, 0.43), vec3(0.33, 0.3, 0.27), up);
    return pow(max(base * (1.0 + 0.12 * tunnelRockGrain(worldAbs)), vec3(0.0)), vec3(1.0 / 2.2));
  }
  /** A tunnel surface's color: its base under THE tunnel light. */
  vec3 tunnelShade(vec3 base, vec3 normal, float daylight, vec3 toSurface) {
    return base * tunnelLightFactor(normal, daylight, toSurface);
  }
`;
