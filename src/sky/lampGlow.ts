import * as THREE from "three";

/**
 * Street-lamp glow channel — "poor man's point lights" for the shaders we
 * control, backed by a GRID DATA TEXTURE so EVERY mounted lamp lights the
 * world (if a lamp is rendered, its light is rendered):
 *
 * World space is binned into LAMP_CELL_SIZE cells; each texel of a
 * LAMP_GRID_SIZE² float texture holds one lamp head (xyz = position,
 * w = color index + 1; 0 = empty — warm lamp glow, or a traffic-signal
 * red/yellow/green). Because the falloff radius equals the cell size, a fragment
 * only ever needs its own cell plus neighbors — 9 texture reads per
 * fragment, CONSTANT cost regardless of lamp count (a uniform-array loop
 * would need ~600 slots to cover the lamp render distance and exceed GPU
 * uniform limits). StreetLampPool rewrites the grid every few frames and
 * drives the global intensity (the dusk/dawn ramp) every frame.
 *
 * Compared to real THREE point lights this costs a few texture reads in
 * exactly the shaders that opt in (instead of full PBR in every lit
 * material), has no near-pole blowout, and — crucially — lights the UNLIT
 * terrain, which real lights can't reach. A tiny real point-light pool
 * remains for GLTF NPCs.
 *
 * Limitation: one lamp per 24u cell — when two lamps share a cell (rare at
 * spawn spacing), only the first casts light.
 */

export const LAMP_GLOW_RADIUS = 24; // world units of falloff reach
/** Must be ≥ LAMP_GLOW_RADIUS so the 3×3 neighborhood covers the falloff. */
export const LAMP_CELL_SIZE = 24;
export const LAMP_GRID_SIZE = 64; // cells per side → 1536u of coverage

/** Glow color indexes (stored in the texel's w channel as index + 1). Keep
 *  in sync with the GLSL selection chain in lampGlowAccumGLSL. */
export const LAMP_COLOR_WARM = 0; // street lamps
export const LAMP_COLOR_RED = 1; // traffic signals
export const LAMP_COLOR_YELLOW = 2;
export const LAMP_COLOR_GREEN = 3;

/** A registered glow source: mutate `color` in place and the next grid
 *  rewrite picks it up (traffic signals change color mid-flight). */
export interface LampHead {
  position: THREE.Vector3;
  color: number;
}

const gridData = new Float32Array(LAMP_GRID_SIZE * LAMP_GRID_SIZE * 4);
const gridTexture = new THREE.DataTexture(gridData, LAMP_GRID_SIZE, LAMP_GRID_SIZE, THREE.RGBAFormat, THREE.FloatType);
gridTexture.magFilter = THREE.NearestFilter;
gridTexture.minFilter = THREE.NearestFilter;
gridTexture.needsUpdate = true;

/** Shared uniform objects — every consumer shader references these. */
export const LAMP_GRID_UNIFORMS = {
  uLampGrid: { value: gridTexture },
  uLampGridOrigin: { value: new THREE.Vector2(0, 0) }, // cell coords of texel (0,0)
  uLampGlowIntensity: { value: 0 }, // global dusk/dawn ramp
};

// Rewrite gate: the periodic driver calls updateLampGrid unconditionally, but
// a fill(0) over 16k floats + a full 64KB texImage2D upload is pure waste
// when nothing changed. Registration/unregistration and traffic-signal color
// flips mark the grid dirty; a camera-driven origin-cell change forces a
// rewrite too (the texels are origin-relative).
let gridDirty = true;
let lastOriginX = Number.NaN;
let lastOriginZ = Number.NaN;
let lastHeadCount = -1;

/** Call whenever the glow-source set changes (a head registered/removed) or
 *  an existing head's `color` is mutated — the next periodic updateLampGrid
 *  call then actually rewrites instead of early-outing. */
export const markLampGridDirty = (): void => {
  gridDirty = true;
};

// Reused buffer for the incoming heads — callers pass Map.values(), a
// single-pass iterator, so it must be materialized before the clean check
// can count it without consuming what the rewrite loop needs.
const headScratch: LampHead[] = [];

/** Rewrite the grid from the mounted lamp heads, centered on the camera.
 *  Called every few frames by the street-lamp driver; skipped entirely while
 *  clean and the origin cell is unchanged. */
export const updateLampGrid = (heads: Iterable<LampHead>, cameraX: number, cameraZ: number): void => {
  const originX = Math.floor(cameraX / LAMP_CELL_SIZE) - LAMP_GRID_SIZE / 2;
  const originZ = Math.floor(cameraZ / LAMP_CELL_SIZE) - LAMP_GRID_SIZE / 2;
  headScratch.length = 0;
  for (const head of heads) headScratch.push(head);
  // The head-count comparison is a backstop for registration paths that
  // mutate activeLampHeads directly without marking dirty (the per-object
  // street-lamp ACTOR) — a plain iteration, far cheaper than the fill +
  // upload it guards.
  if (
    !gridDirty &&
    originX === lastOriginX &&
    originZ === lastOriginZ &&
    headScratch.length === lastHeadCount
  ) {
    headScratch.length = 0;
    return;
  }

  gridData.fill(0);
  LAMP_GRID_UNIFORMS.uLampGridOrigin.value.set(originX, originZ);
  for (const head of headScratch) {
    const p = head.position;
    const cx = Math.floor(p.x / LAMP_CELL_SIZE) - originX;
    const cz = Math.floor(p.z / LAMP_CELL_SIZE) - originZ;
    if (cx < 0 || cx >= LAMP_GRID_SIZE || cz < 0 || cz >= LAMP_GRID_SIZE) continue;
    const idx = (cz * LAMP_GRID_SIZE + cx) * 4;
    if (gridData[idx + 3] > 0) continue; // cell already occupied — first lamp wins
    gridData[idx] = p.x;
    gridData[idx + 1] = p.y;
    gridData[idx + 2] = p.z;
    gridData[idx + 3] = head.color + 1;
  }
  gridTexture.needsUpdate = true;
  gridDirty = false;
  lastOriginX = originX;
  lastOriginZ = originZ;
  lastHeadCount = headScratch.length;
  headScratch.length = 0;
};

export const setLampGlowIntensity = (value: number): void => {
  LAMP_GRID_UNIFORMS.uLampGlowIntensity.value = value;
};

/** Uniform declarations for shaders that inject lampGlowAccumGLSL manually
 *  (the terrain material auto-declares from its uniforms map instead). */
export const lampGlowUniformsGLSL = `
uniform sampler2D uLampGrid;
uniform vec2 uLampGridOrigin;
uniform float uLampGlowIntensity;
`;

/** GLSL statements accumulating the glow at `worldPosExpr` into a local
 *  `vec3 lampGlowSum`. Requires the lampGlow uniforms in scope. */
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

/** Patch a LIT standard material so lamp glow joins its indirect irradiance
 *  (surfaces near a lamp genuinely brighten in the lamp's color). Chains
 *  after any existing onBeforeCompile; one shader program per template. */
export const patchStandardMaterialLampGlow = (material: THREE.Material, strength = 0.5): void => {
  if ((material as any).__lampGlowPatched) return;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey?.bind(material);
  // strength is baked into the GLSL below, so two patches with different
  // strengths are different programs — the key must reflect that or the
  // second material silently reuses the first one's compiled shader.
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
