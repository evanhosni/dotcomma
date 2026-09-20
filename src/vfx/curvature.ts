import * as THREE from "three";

/**
 * WORLD CURVATURE (CLAUDE.md → vfx/curvature.ts): a VERTEX effect on the camera-relative
 * view position, applied from exactly four places (terrain vertex.glsl, the foliage shader,
 * prepareActorMaterial, prepareDressingMaterial) — never per object, or content floats off
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

  /** Idempotent and order-independent with the other patchers: CHAINS onBeforeCompile (assigning
   *  silently discards another patch's edits) and falls back to the raw projection line when
   *  `_quantization` has already replaced `#include <project_vertex>`. */
  export const patchMaterial = (material: THREE.Material): void => {
    if ((material as any).__curvaturePatched) return;
    (material as any).__curvaturePatched = true;

    const originalCacheKey = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => (originalCacheKey?.() ?? "") + "_curved";

    const prevOnBeforeCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prevOnBeforeCompile?.call(material, shader, renderer);
      shader.uniforms.uCurveStart = uniforms.uCurveStart;
      shader.uniforms.uCurveK = uniforms.uCurveK;

      shader.vertexShader = shader.vertexShader.replace("void main() {", CURVE_GLSL + "\nvoid main() {");

      shader.vertexShader = shader.vertexShader.includes("#include <project_vertex>")
        ? shader.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n" + CURVE_STEP)
        : shader.vertexShader.replace(
            "gl_Position = projectionMatrix * mvPosition;",
            "gl_Position = projectionMatrix * mvPosition;\n" + CURVE_STEP,
          );
    };

    material.needsUpdate = true;
  };
}
