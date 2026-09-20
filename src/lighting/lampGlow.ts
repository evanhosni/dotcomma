import * as THREE from "three";
import { getWindowLightsProgress } from "./dayNight";

/**
 * The lamp-glow GRID DATA TEXTURE (CLAUDE.md → lighting/lampGlow.ts): one glow head per
 * LAMP_CELL_SIZE cell (texel = xyz + color index + 1, 0 = empty). Shaders read their 3×3
 * neighborhood — 9 reads per fragment, constant for any lamp count, and it lights the UNLIT
 * terrain that real point lights can't reach. Limitation: two heads in one cell → first wins.
 */

export const LAMP_GLOW_RADIUS = 24; // world units of falloff reach
/** Must be ≥ LAMP_GLOW_RADIUS so the 3×3 neighborhood covers the falloff. */
export const LAMP_CELL_SIZE = 24;
export const LAMP_GRID_SIZE = 64; // cells per side → 1536u of coverage

/** Stored as index + 1 in the texel's w; keep in sync with the selection chain in lampGlowAccumGLSL. */
export const LAMP_COLOR_WARM = 0;
export const LAMP_COLOR_RED = 1;
export const LAMP_COLOR_YELLOW = 2;
export const LAMP_COLOR_GREEN = 3;

/** Mutate `color` in place (traffic signals) — the next grid rewrite picks it up. */
export interface LampHead {
  position: THREE.Vector3;
  color: number;
}

const gridData = new Float32Array(LAMP_GRID_SIZE * LAMP_GRID_SIZE * 4);
const gridTexture = new THREE.DataTexture(gridData, LAMP_GRID_SIZE, LAMP_GRID_SIZE, THREE.RGBAFormat, THREE.FloatType);
gridTexture.magFilter = THREE.NearestFilter;
gridTexture.minFilter = THREE.NearestFilter;
gridTexture.needsUpdate = true;

export const LAMP_GRID_UNIFORMS = {
  uLampGrid: { value: gridTexture },
  uLampGridOrigin: { value: new THREE.Vector2(0, 0) }, // cell coords of texel (0,0)
  uLampGlowIntensity: { value: 0 }, // global dusk/dawn ramp
};

let gridDirty = true;
let lastOriginX = Number.NaN;
let lastOriginZ = Number.NaN;
let lastHeadCount = -1;

/** MUST be called by anything that adds/removes/recolors a head, or the 64KB grid re-upload
 *  skips the change (the head-count check below is only a backstop and misses same-count swaps). */
export const markLampGridDirty = (): void => {
  gridDirty = true;
};

const headBuffer: LampHead[] = [];

export const updateLampGrid = (heads: ReadonlyMap<string, LampHead>, cameraX: number, cameraZ: number): void => {
  const originX = Math.floor(cameraX / LAMP_CELL_SIZE) - LAMP_GRID_SIZE / 2;
  const originZ = Math.floor(cameraZ / LAMP_CELL_SIZE) - LAMP_GRID_SIZE / 2;
  if (!gridDirty && originX === lastOriginX && originZ === lastOriginZ && heads.size === lastHeadCount) {
    return;
  }
  headBuffer.length = 0;
  for (const head of heads.values()) headBuffer.push(head);

  gridData.fill(0);
  LAMP_GRID_UNIFORMS.uLampGridOrigin.value.set(originX, originZ);
  for (const head of headBuffer) {
    const p = head.position;
    const cx = Math.floor(p.x / LAMP_CELL_SIZE) - originX;
    const cz = Math.floor(p.z / LAMP_CELL_SIZE) - originZ;
    if (cx < 0 || cx >= LAMP_GRID_SIZE || cz < 0 || cz >= LAMP_GRID_SIZE) continue;
    const idx = (cz * LAMP_GRID_SIZE + cx) * 4;
    if (gridData[idx + 3] > 0) continue; // first head in a cell wins
    gridData[idx] = p.x;
    gridData[idx + 1] = p.y;
    gridData[idx + 2] = p.z;
    gridData[idx + 3] = head.color + 1;
  }
  gridTexture.needsUpdate = true;
  gridDirty = false;
  lastOriginX = originX;
  lastOriginZ = originZ;
  lastHeadCount = headBuffer.length;
  headBuffer.length = 0;
};

export const setLampGlowIntensity = (value: number): void => {
  LAMP_GRID_UNIFORMS.uLampGlowIntensity.value = value;
};

/** Every mounted glow source (street-lamp heads, traffic-signal lamps), keyed per feature. */
export const activeLampHeads = new Map<string, LampHead>();

/** Lit windows sit around 1.4; street lights burn much brighter. */
export const LAMP_EMISSIVE_STRENGTH = 12;

export const unregisterLampHeads = (keys: Iterable<string>): void => {
  for (const key of keys) activeLampHeads.delete(key);
  markLampGridDirty();
  clearLampGridIfEmpty();
};

/** With no heads nobody drives the grid, so ghost light pools would linger on the terrain. */
export const clearLampGridIfEmpty = (): void => {
  if (activeLampHeads.size === 0) {
    updateLampGrid(activeLampHeads, 0, 0);
    setLampGlowIntensity(0);
  }
};

const GRID_REWRITE_INTERVAL_FRAMES = 20; // frames between grid rewrites

let lastDriveTime = -1;
let driveFrameCount = 0;

/** The FIRST caller per frame does the work (time-guarded), so no system component has to be
 *  mounted — every feature that owns glow sources calls this from its frame loop. */
export const driveLampLighting = (camera: THREE.Camera, time: number): void => {
  if (time === lastDriveTime) return;
  lastDriveTime = time;
  setLampGlowIntensity(getWindowLightsProgress());
  if (driveFrameCount++ % GRID_REWRITE_INTERVAL_FRAMES === 0) {
    updateLampGrid(activeLampHeads, camera.position.x, camera.position.z);
  }
};

/** For shaders that inject lampGlowAccumGLSL by hand (the terrain material auto-declares). */
const lampGlowUniformsGLSL = `
uniform sampler2D uLampGrid;
uniform vec2 uLampGridOrigin;
uniform float uLampGlowIntensity;
`;

/** Accumulates the glow at `worldPosExpr` into a local `vec3 lampGlowSum`. */
export const lampGlowAccumGLSL = (worldPosExpr: string): string => `
  vec3 lampGlowSum = vec3(0.0);
  if (uLampGlowIntensity > 0.001) {
    vec2 lampCell = floor(${worldPosExpr}.xz / ${LAMP_CELL_SIZE.toFixed(1)});
    for (int lampGi = -1; lampGi <= 1; lampGi++) {
      for (int lampGj = -1; lampGj <= 1; lampGj++) {
        vec2 lampTC = (lampCell + vec2(float(lampGi), float(lampGj)) - uLampGridOrigin + 0.5) / ${LAMP_GRID_SIZE.toFixed(1)};
        if (lampTC.x < 0.0 || lampTC.x > 1.0 || lampTC.y < 0.0 || lampTC.y > 1.0) continue;
        vec4 lampG = texture2D(uLampGrid, lampTC);
        if (lampG.w > 0.5) {
          float lampFall = clamp(1.0 - distance(${worldPosExpr}, lampG.xyz) / ${LAMP_GLOW_RADIUS.toFixed(1)}, 0.0, 1.0);
          // w = color index + 1: 1 warm street lamp, 2/3/4 = signal red/yellow/green
          vec3 lampCol = lampG.w > 3.5 ? vec3(0.15, 1.0, 0.4)
            : lampG.w > 2.5 ? vec3(1.0, 0.72, 0.1)
            : lampG.w > 1.5 ? vec3(1.0, 0.16, 0.1)
            : vec3(1.0, 0.82, 0.45);
          lampGlowSum += lampCol * (lampFall * lampFall);
        }
      }
    }
    lampGlowSum *= uLampGlowIntensity;
  }
`;

/** Adds lamp glow to a lit material's indirect irradiance. Chains after any existing onBeforeCompile. */
export const patchStandardMaterialLampGlow = (material: THREE.Material, strength = 0.5): void => {
  if ((material as any).__lampGlowPatched) return;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey?.bind(material);
  // strength is baked into the GLSL: a different strength is a different program, and without it
  // in the key the second material silently reuses the first one's compiled shader.
  material.customProgramCacheKey = () => (prevKey?.() ?? "") + "_lampGlow" + strength.toFixed(2);
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uLampGrid = LAMP_GRID_UNIFORMS.uLampGrid;
    shader.uniforms.uLampGridOrigin = LAMP_GRID_UNIFORMS.uLampGridOrigin;
    shader.uniforms.uLampGlowIntensity = LAMP_GRID_UNIFORMS.uLampGlowIntensity;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLampWorldPos;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvLampWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${lampGlowUniformsGLSL}\nvarying vec3 vLampWorldPos;`)
      .replace(
        "#include <lights_fragment_begin>",
        `#include <lights_fragment_begin>
        ${lampGlowAccumGLSL("vLampWorldPos")}
        irradiance += lampGlowSum * ${strength.toFixed(2)};`,
      );
  };
  (material as any).__lampGlowPatched = true;
  material.needsUpdate = true;
};
