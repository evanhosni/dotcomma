import * as THREE from "three";
import { glslFloat } from "../world/shaders/utils";
import { WORLD_WRAP } from "../world/shaders/constants";
import type { QuantizationGrowth } from "./types";

type ShaderPatch = (...args: Parameters<THREE.Material["onBeforeCompile"]>) => void;

/** Adds `patch` to the material's shader WITHOUT losing the patches already on it: it CHAINS
 *  onBeforeCompile (assigning silently discards another patcher's edits — quantization once dropped the
 *  lamp glow's) and appends `cacheKeySuffix` to the program cache key (a patched shader is another
 *  program). Every material patcher (curvature, quantization, spawn fade, lamp glow) goes through here. */
export const chainMaterialPatch = (material: THREE.Material, cacheKeySuffix: string, patch: ShaderPatch): void => {
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (previousCacheKey?.() ?? "") + cacheKeySuffix;

  const previousPatch = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousPatch?.call(material, shader, renderer);
    patch(shader, renderer);
  };

  material.needsUpdate = true;
};

/**
 * WORLD CURVATURE (CLAUDE.md → vfx/material.ts): a VERTEX effect on the camera-relative
 * view position, applied from exactly six places (terrain vertex.glsl, the water shader, the
 * foliage shader, prepareActorMaterial, prepareChunkMaterial, the sprite material) — never per object, or content floats off
 * the ground it stands on. Three easy-to-break rules live in curveViewPos:
 *  1. sink along WORLD down (viewMatrix[1].xyz), not view down — view-y swings the world as the camera pitches;
 *  2. measure HORIZONTAL distance — with 3D distance a tall building overhead sinks as if far away;
 *  3. max(0, r - start)² is C¹ at the flat-zone edge — a nonzero starting slope creases the ground at `start`.
 */
export namespace _curvature {
  export const uniforms = {
    /** Radius of the flat zone around the camera. */
    uCurveStart: { value: 100.0 } as THREE.IUniform<number>,
    /** 1/(2R). 0 = disabled. */
    uCurveK: { value: 0.0 } as THREE.IUniform<number>,
  };

  export const CURVE_GLSL = /* glsl */ `
    uniform float uCurveStart;
    uniform float uCurveK;

    vec3 curveViewPos(vec3 viewPos) {
      if (uCurveK <= 0.0) return viewPos;
      // World +Y in view space (column 1 of the view rotation) keeps the drop vertical.
      vec3 up = viewMatrix[1].xyz;
      float h = dot(viewPos, up);
      float r = length(viewPos - up * h);        // horizontal camera distance
      float d = max(0.0, r - uCurveStart);       // C¹ at the flat-zone edge
      return viewPos - up * (uCurveK * d * d);   // d²/(2R): sphere drop
    }
  `;

  /** `radius` = the illusory planet radius (0/undefined = flat). At 20000: drops 4u at 500u out, 20u at 1000, 90u at 2000. */
  export const setCurvature = (radius: number | undefined, start = 100): void => {
    uniforms.uCurveK.value = radius && radius > 0 ? 1 / (2 * radius) : 0;
    uniforms.uCurveStart.value = start;
  };

  const CURVE_STEP = /* glsl */ `
    mvPosition.xyz = curveViewPos( mvPosition.xyz );
    gl_Position = projectionMatrix * mvPosition;
  `;

  /** Idempotent and order-independent with the other patchers: falls back to the raw projection line
   *  when `_quantization` has already replaced `#include <project_vertex>`. */
  export const patchMaterial = (material: THREE.Material): void => {
    if ((material as any).__curvaturePatched) return;
    (material as any).__curvaturePatched = true;

    chainMaterialPatch(material, "_curved", (shader) => {
      shader.uniforms.uCurveStart = uniforms.uCurveStart;
      shader.uniforms.uCurveK = uniforms.uCurveK;

      shader.vertexShader = shader.vertexShader.replace("void main() {", CURVE_GLSL + "\nvoid main() {");

      shader.vertexShader = shader.vertexShader.includes("#include <project_vertex>")
        ? shader.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n" + CURVE_STEP)
        : shader.vertexShader.replace(
            "gl_Position = projectionMatrix * mvPosition;",
            "gl_Position = projectionMatrix * mvPosition;\n" + CURVE_STEP,
          );
    });
  };
}

/** ±0.5/255 screen-space hash dither for slow gradients before 8-bit output; `target` is an rgb or alpha expression. */
export const ditherGLSL = (target: string): string =>
  `${target} += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;`;

/** Screen-door threshold: a 4×4 Bayer matrix at (k + 0.5)/16, so a visibility of 1 never discards and 0 always does. The spawn fade's look (vfx/spawn-fade/index.ts). */
export const SCREEN_DOOR_GLSL = /* glsl */ `
  float screenDoorBayer2(vec2 a) { a = mod(floor(a), 2.0); return fract(a.x * 0.5 + a.y * 0.75); }
  float screenDoorThreshold(vec2 fragCoord) {
    return screenDoorBayer2(fragCoord) + screenDoorBayer2(fragCoord * 0.5) * 0.25 + 0.03125;
  }
`;

/** DISTANCE QUANTIZATION: past `start` the grid grows with the vertex's horizontal camera distance d as
 *  size × ((d − start) / 1km)^power (QuantizationGrowth), rounded DOWN to the next of these steps (never
 *  under uGridSize). Inside `start` only the base grid applies.
 *  Steps, not a continuous size: a grid that changed with every step of the camera would swim every
 *  vertex; a step only re-snaps the vertices crossing its band. Each divides WORLD_WRAP: the wrapped
 *  programs (terrain, water, tunnels) anchor the lattice to wrapped coordinates and the patched ones to
 *  absolute, and only a divisor gives both the same lattice, with no seam at a wrap line. The last step
 *  is past any view distance: there is no max distance short of it. */
const DISTANCE_GRIDS = [0.25, 0.5, 1, 2, 4, 8, 15, 30, 60, 120, 210, 420, 840, 2100, 4200];
for (const g of DISTANCE_GRIDS) if (!Number.isInteger(WORLD_WRAP / g)) throw new Error(`quantization grid ${g} does not divide WORLD_WRAP`);

const distanceGridGLSL = (): string =>
  [...DISTANCE_GRIDS]
    .reverse()
    .map((g) => `if (grow >= ${glslFloat(g)}) return max(uGridSize, ${glslFloat(g)});`)
    .join("\n      ");

export namespace _quantization {
  export const uniforms = {
    uGridSize: { value: 0.0 } as THREE.IUniform<number>,
    /** (start, size, power) of the distance curve (QuantizationGrowth). size 0 = the base grid everywhere:
     *  OFF by default (no domain sets it); start and power hold the tuned curve, so the devmode size slider
     *  alone turns it on as it was (size 12). */
    uGridGrowth: { value: new THREE.Vector3(700, 0, 2) } as THREE.IUniform<THREE.Vector3>,
  };

  /** Injected before main() in patched materials and interpolated into the custom terrain/foliage shaders,
   *  so the functions exist once. Every caller passes the view-space position BEFORE quantization (the
   *  grid must not depend on its own result) — the same vertex gets the same grid in every program. */
  export const QUANTIZE_GLSL = /* glsl */ `
    uniform float uGridSize;
    uniform vec3 uGridGrowth;

    /** Horizontal camera distance of a view-space position (as the curvature and the far fade measure it). */
    float quantizeDistance(vec3 viewPos) {
      vec3 up = viewMatrix[1].xyz;
      return length(viewPos - up * dot(viewPos, up));
    }

    float quantizeGridAt(vec3 viewPos) {
      float past = max(quantizeDistance(viewPos) - uGridGrowth.x, 0.0) * 0.001;
      float grow = uGridGrowth.y * pow(past, uGridGrowth.z);
      ${distanceGridGLSL()}
      return uGridSize;
    }

    vec3 quantizeWorldPos(vec3 worldPos, vec3 viewPos) {
      float grid = quantizeGridAt(viewPos);
      if (grid <= 0.0) return worldPos;
      return floor(worldPos / grid + 0.5) * grid;
    }
  `;

  /**
   * Replacement for #include <project_vertex>: quantizes on a WORLD-ALIGNED lattice
   * without ever forming an absolute world coordinate (float32 made the lattice
   * swim past ~100k units and collapse past ~420k). The offset from the object's
   * own origin is quantized; `qPhase` re-anchors the lattice to the world and is
   * constant per object. See CLAUDE.md "Coordinate Precision".
   */
  const PROJECT_VERTEX_REPLACEMENT = /* glsl */ `
    vec4 mvPosition = vec4( transformed, 1.0 );

    #ifdef USE_INSTANCING

      // Absolute-space math kept: modelMatrix * instanceMatrix is already the
      // true world position under the dressing rebase (finalizeInstancedChunk).
      // No instanced material is quantized today.
      mvPosition = instanceMatrix * mvPosition;
      vec4 qWorldPos = modelMatrix * mvPosition;
      qWorldPos.xyz = quantizeWorldPos( qWorldPos.xyz, ( viewMatrix * qWorldPos ).xyz );
      mvPosition = viewMatrix * qWorldPos;

    #else

      vec3 qLocal = mat3( modelMatrix ) * mvPosition.xyz;
      float qGrid = quantizeGridAt( modelViewMatrix[ 3 ].xyz + mat3( viewMatrix ) * qLocal );
      if ( qGrid > 0.0 ) {
        vec3 qPhase = mod( modelMatrix[ 3 ].xyz, qGrid );
        qLocal = floor( ( qLocal + qPhase ) / qGrid + 0.5 ) * qGrid - qPhase;
      }
      mvPosition = vec4( modelViewMatrix[ 3 ].xyz + mat3( viewMatrix ) * qLocal, 1.0 );

    #endif

    gl_Position = projectionMatrix * mvPosition;
  `;

  /** Replacement for #include <worldpos_vertex> — keeps shadows/envmaps consistent. */
  const WORLDPOS_VERTEX_REPLACEMENT = /* glsl */ `
    #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined( USE_SHADOWMAP ) || defined( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
      vec4 worldPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        worldPosition = instanceMatrix * worldPosition;
      #endif
      worldPosition = modelMatrix * worldPosition;
      worldPosition.xyz = quantizeWorldPos(worldPosition.xyz, (viewMatrix * worldPosition).xyz);
    #endif
  `;

  /** Idempotent. `gridSize` overrides the global grid for this material (fixed at
   *  first patch; later calls only update an existing override). */
  export const patchMaterial = (material: THREE.Material, gridSize?: number): void => {
    const existing = (material as any).__quantizationUniform as THREE.IUniform<number> | undefined;
    if (existing) {
      if (gridSize !== undefined && existing !== uniforms.uGridSize) existing.value = gridSize;
      return;
    }

    const uniform: THREE.IUniform<number> =
      gridSize !== undefined ? { value: gridSize } : uniforms.uGridSize;

    (material as any).__quantizationUniform = uniform;
    chainMaterialPatch(material, "_quantized", (shader) => {
      shader.uniforms.uGridSize = uniform;
      shader.uniforms.uGridGrowth = uniforms.uGridGrowth;

      shader.vertexShader = shader.vertexShader.replace(
        "void main() {",
        QUANTIZE_GLSL + "\nvoid main() {",
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        PROJECT_VERTEX_REPLACEMENT,
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        WORLDPOS_VERTEX_REPLACEMENT,
      );
    });
  };

  /** The distance curve; a partial growth changes only those fields. `{ size: 0 }` = off. */
  export const setGridGrowth = (growth: Partial<QuantizationGrowth>): void => {
    const v = uniforms.uGridGrowth.value;
    v.set(growth.start ?? v.x, growth.size ?? v.y, growth.power ?? v.z);
  };

  /** Set the global grid size. 0 = quantization disabled. */
  export const setGridSize = (size: number): void => {
    uniforms.uGridSize.value = size;
  };
}
