import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { glslFloat } from "../world/shaders/constants";
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

/** Every glow color. A head's `color` is an index into this list (stored as index + 1 in the
 *  texel's w), and the shader's color selection is generated from it — add a color here. */
export const LAMP_COLORS = [
  { name: "warm", rgb: [1.0, 0.82, 0.45] }, // street lamps
  { name: "red", rgb: [1.0, 0.16, 0.1] },
  { name: "yellow", rgb: [1.0, 0.72, 0.1] },
  { name: "green", rgb: [0.15, 1.0, 0.4] },
] as const;

export type LampColorName = (typeof LAMP_COLORS)[number]["name"];
export const lampColorIndex = (name: LampColorName): number => LAMP_COLORS.findIndex((c) => c.name === name);

export const LAMP_COLOR_WARM = lampColorIndex("warm");
export const LAMP_COLOR_RED = lampColorIndex("red");
export const LAMP_COLOR_YELLOW = lampColorIndex("yellow");
export const LAMP_COLOR_GREEN = lampColorIndex("green");

/** Recolor through setLampHeadColor, which marks the grid dirty. */
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

/** Every add/remove/recolor of a head calls this, or the 64KB grid re-upload skips the change (the
 *  head-count check below is only a backstop and misses same-count swaps). */
const markLampGridDirty = (): void => {
  gridDirty = true;
};

const headBuffer: LampHead[] = [];

const updateLampGrid = (heads: ReadonlyMap<string, LampHead>, cameraX: number, cameraZ: number): void => {
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

const setLampGlowIntensity = (value: number): void => {
  LAMP_GRID_UNIFORMS.uLampGlowIntensity.value = value;
};

/** Every mounted glow source. Insertion order decides which head wins a shared cell. */
const lampHeads = new Map<string, LampHead>();
/** Read-only view (tests, debugging): add and remove heads with registerLampHeads. */
export const activeLampHeads: ReadonlyMap<string, LampHead> = lampHeads;

/** Lit windows sit around 1.4; street lights burn much brighter. */
export const LAMP_EMISSIVE_STRENGTH = 12;

let registrationCount = 0;

/**
 * THE way to add glow sources: registers `heads` under generated keys (they can never collide
 * with another feature's, or with a rebuilt chunk's), marks the grid dirty, and returns the
 * disposer that removes them. LampGlowDriver (mounted once in CustomCanvas) drives the grid
 * whenever any head is registered, so nothing else is needed. `source` only labels the keys.
 */
export const registerLampHeads = (source: string, heads: readonly LampHead[]): (() => void) => {
  const prefix = `${source}#${registrationCount++}:`;
  const keys = heads.map((head, i) => {
    const key = prefix + i;
    lampHeads.set(key, head);
    return key;
  });
  markLampGridDirty();
  return () => unregisterLampHeads(keys);
};

export const setLampHeadColor = (head: LampHead, color: number): void => {
  if (head.color === color) return;
  head.color = color;
  markLampGridDirty();
};

const unregisterLampHeads = (keys: Iterable<string>): void => {
  for (const key of keys) lampHeads.delete(key);
  markLampGridDirty();
  clearLampGridIfEmpty();
};

/** With no heads nobody drives the grid, so ghost light pools would linger on the terrain. */
const clearLampGridIfEmpty = (): void => {
  if (lampHeads.size === 0) {
    updateLampGrid(lampHeads, 0, 0);
    setLampGlowIntensity(0);
  }
};

const GRID_REWRITE_INTERVAL_FRAMES = 20; // frames between grid rewrites

let lastDriveTime = -1;
let driveFrameCount = 0;

/** Time-guarded: the FIRST caller per frame does the work, so extra callers are harmless. */
const driveLampLighting = (camera: THREE.Camera, time: number): void => {
  if (time === lastDriveTime) return;
  lastDriveTime = time;
  setLampGlowIntensity(getWindowLightsProgress());
  if (driveFrameCount++ % GRID_REWRITE_INTERVAL_FRAMES === 0) {
    updateLampGrid(lampHeads, camera.position.x, camera.position.z);
  }
};

/** Drives the grid every frame while any head is registered. Mounted once, in CustomCanvas. */
export const LampGlowDriver = (): null => {
  useFrame((state) => {
    if (lampHeads.size > 0) driveLampLighting(state.camera, state.clock.elapsedTime);
  });
  return null;
};

/** The declarations lampGlowAccumGLSL needs, for a ShaderMaterial that spreads LAMP_GRID_UNIFORMS. */
export const LAMP_GLOW_UNIFORMS_GLSL = `
uniform sampler2D uLampGrid;
uniform vec2 uLampGridOrigin;
uniform float uLampGlowIntensity;
`;

const vec3GLSL = (rgb: readonly number[]): string => `vec3(${rgb.map(glslFloat).join(", ")})`;

/** `lampG.w > 3.5 ? green : lampG.w > 2.5 ? yellow : … : warm` (w = color index + 1). */
const LAMP_COLOR_SELECT_GLSL = LAMP_COLORS.slice(1).reduce(
  (chain, color, i) => `lampG.w > ${glslFloat(i + 1.5)} ? ${vec3GLSL(color.rgb)} : ${chain}`,
  vec3GLSL(LAMP_COLORS[0].rgb),
);

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
          vec3 lampCol = ${LAMP_COLOR_SELECT_GLSL};
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
        "#include <begin_vertex>\nvec4 lampLocal = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nlampLocal = instanceMatrix * lampLocal;\n#endif\nvLampWorldPos = (modelMatrix * lampLocal).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${LAMP_GLOW_UNIFORMS_GLSL}\nvarying vec3 vLampWorldPos;`)
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
