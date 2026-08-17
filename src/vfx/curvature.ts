import * as THREE from "three";

/**
 * WORLD CURVATURE — the "walking on a globe" illusion.
 *
 * Past `uCurveStart` units from the camera, every vertex is pushed DOWN by
 * `(distance - start)² / (2R)` — the small-angle drop of a sphere of radius R —
 * so the ground falls away and distant content sinks behind a curved horizon.
 *
 * This is a VERTEX effect, deliberately not post-processing: bending the
 * finished image moves pixels without moving depth, so occlusion, parallax and
 * the horizon itself would all disagree with the geometry (and near objects
 * would smear with the far ones). Displacing before the projection makes the
 * curve real to everything downstream — depth, culling order, the lot.
 *
 * PURELY VISUAL. Physics, raycasts, spawn placement and the terrain height
 * pipeline all keep working on the flat world, which is what makes the illusion
 * free: the player walks a plane and sees a globe. Every interaction reach in
 * the game (doors 6u, CRT 14u) sits well inside the flat zone, so nothing the
 * player can touch is ever displaced from where it looks.
 *
 * Three rules make the displacement correct, and all three are easy to get
 * wrong:
 *
 *  1. Sink along WORLD down, not view down. `viewMatrix[1].xyz` is world +Y
 *     expressed in view space (column 1 of the rotation = M * (0,1,0)). Using
 *     viewPos.y instead would swing the whole world sideways as the camera
 *     pitches.
 *  2. Measure HORIZONTAL distance (the component perpendicular to that up
 *     vector). With a 3D distance, a tall building directly overhead would sink
 *     as if it were far away.
 *  3. Use max(0, r - start)², which is C¹ at the boundary — a drop that starts
 *     with a nonzero slope puts a visible crease around the player at exactly
 *     `start` units.
 *
 * It operates on the VIEW-space position, which is camera-relative and
 * therefore small, so it is immune to the distance-from-origin float32 problems
 * documented in CLAUDE.md — it never forms an absolute world coordinate, and it
 * runs AFTER quantization so the lattice keeps its world phase.
 *
 * Every vertex path in the scene must apply the SAME function or content will
 * visibly float off the ground it stands on — which is why nothing applies it
 * per object. Two hand-written shaders call `curveViewPos` directly (the
 * terrain, `world/shaders/vertex.glsl`, and the foliage base,
 * `objects/foliage/Foliage.tsx`); everything else built on a stock three
 * material goes through `patchMaterial` below, called from exactly three
 * places — the three game-object class bases:
 *
 *   - ACTORS   → prepareActorMaterial   (objects/actors/Actor.tsx)
 *   - DRESSING → prepareDressingMaterial (objects/dressing/Dressing.tsx)
 *   - FOLIAGE  → the base's own shader   (objects/foliage/Foliage.tsx)
 *
 * A new game object inherits the curve by belonging to one of those classes.
 * If you find yourself calling patchMaterial from an object's own file, the
 * object is bypassing its base.
 *
 * The sky is deliberately EXEMPT: the skybox and celestial bodies are a dome
 * pinned to the camera, so bending them would just tip the sky over.
 */
export namespace _curvature {
  /** Shared uniform objects — one reference held by every patched material. */
  export const uniforms = {
    /** Radius of the flat zone around the camera. */
    uCurveStart: { value: 100.0 } as THREE.IUniform<number>,
    /** 1/(2R). 0 = disabled (the shader early-outs on a uniform branch). */
    uCurveK: { value: 0.0 } as THREE.IUniform<number>,
  };

  /** Uniform declarations + `curveViewPos`, injected before main(). */
  export const CURVE_GLSL = /* glsl */ `
    uniform float uCurveStart;
    uniform float uCurveK;

    // viewPos: VIEW-space position (camera-relative, so always small).
    vec3 curveViewPos(vec3 viewPos) {
      if (uCurveK <= 0.0) return viewPos;
      // World +Y in view space — column 1 of the view rotation. Free, and it
      // keeps the drop vertical no matter where the camera is looking.
      vec3 up = viewMatrix[1].xyz;
      float h = dot(viewPos, up);
      float r = length(viewPos - up * h);        // horizontal camera distance
      float d = max(0.0, r - uCurveStart);       // C¹ at the flat-zone edge
      return viewPos - up * (uCurveK * d * d);   // d²/(2R): sphere drop
    }
  `;

  /**
   * Set the curve. `radius` is the illusory planet radius in world units
   * (0/undefined = flat); `start` is the flat zone around the player.
   *
   * Drop = (d - start)² / (2 × radius). At radius 20000: 4u at 500 units out,
   * 20u at 1000, 90u at 2000.
   */
  export const setCurvature = (radius: number | undefined, start = 100): void => {
    uniforms.uCurveK.value = radius && radius > 0 ? 1 / (2 * radius) : 0;
    uniforms.uCurveStart.value = start;
  };

  /** How far the surface has dropped at a given HORIZONTAL camera distance.
   *  (CPU mirror of the shader — for culling padding or debug readouts.) */
  export const dropAt = (horizontalDistance: number): number => {
    const d = Math.max(0, horizontalDistance - uniforms.uCurveStart.value);
    return uniforms.uCurveK.value * d * d;
  };

  const CURVE_STEP = /* glsl */ `
    mvPosition.xyz = curveViewPos( mvPosition.xyz );
    gl_Position = projectionMatrix * mvPosition;
  `;

  /**
   * Patch a stock three material (Basic/Standard/…, instanced or skinned) to
   * curve. Idempotent, and safe in either order with the other material
   * patchers in the codebase:
   *
   *  - It CHAINS onto any existing onBeforeCompile rather than assigning
   *    (assigning silently discarded the other patch's shader edits — the same
   *    trap `_quantization` documents).
   *  - It appends after `#include <project_vertex>` if that include is still
   *    there, and falls back to the projection line itself for materials whose
   *    include `_quantization` has already replaced. Either way the curve
   *    lands on the finished view-space `mvPosition`, and any LATER patch that
   *    recomputes gl_Position from mvPosition (the building window-depth bias)
   *    inherits the curved value instead of fighting it.
   */
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
