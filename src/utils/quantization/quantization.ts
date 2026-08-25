import * as THREE from "three";

export namespace _quantization {
  /** Shared uniform — single object reference used by all materials. */
  export const uniforms = {
    uGridSize: { value: 0.0 } as THREE.IUniform<number>,
  };

  /** Uniform declaration + `quantizeWorldPos`, injected before main() in
   *  standard material vertex shaders — and interpolated into the custom
   *  shaders (terrain, foliage) so the function exists exactly once. */
  export const QUANTIZE_GLSL = /* glsl */ `
    uniform float uGridSize;

    vec3 quantizeWorldPos(vec3 worldPos) {
      if (uGridSize <= 0.0) return worldPos;
      return floor(worldPos / uGridSize + 0.5) * uGridSize;
    }
  `;

  /**
   * Replacement for #include <project_vertex> — quantizes on a WORLD-ALIGNED
   * lattice, but never forms an absolute world coordinate to do it.
   *
   * GLSL is float32: at 100k units from the world origin its resolution is
   * ~0.008u, a THIRD of the 0.025u grid. Quantizing `modelMatrix * position`
   * directly therefore made the lattice flicker under the camera (vertices
   * flipping cells frame to frame = swimming geometry) instead of holding
   * still, getting worse the further the player travelled — and past ~420k
   * units `worldPos / 0.025` leaves float32's exact-integer range and the
   * result collapses outright.
   *
   * Instead the offset from the object's OWN origin is quantized:
   * mat3() drops the translation so that offset stays object-sized and exact,
   * and modelViewMatrix[3] is the object origin in view space, already
   * resolved on the CPU in float64. `qPhase` re-anchors the lattice to the
   * world so the wobble doesn't slide along with the object; its own accuracy
   * is limited by the float32 model matrix, but it is CONSTANT per object, so
   * it shows up as a fixed sub-cell offset rather than as flicker.
   */
  const PROJECT_VERTEX_REPLACEMENT = /* glsl */ `
    vec4 mvPosition = vec4( transformed, 1.0 );

    #ifdef USE_INSTANCING

      // Instanced quantized materials keep the original absolute-space math.
      // (Dressing chunks rebase their instance translations to a chunk-local
      // origin with the chunk translation on modelMatrix — see
      // finalizeInstancedChunk — so modelMatrix * instanceMatrix is still the
      // correct absolute world position here; quantizing it would just
      // reintroduce float32 absolute precision. No instanced material is
      // quantized today.)
      mvPosition = instanceMatrix * mvPosition;
      vec4 qWorldPos = modelMatrix * mvPosition;
      qWorldPos.xyz = quantizeWorldPos( qWorldPos.xyz );
      mvPosition = viewMatrix * qWorldPos;

    #else

      vec3 qLocal = mat3( modelMatrix ) * mvPosition.xyz;
      if ( uGridSize > 0.0 ) {
        vec3 qPhase = mod( modelMatrix[ 3 ].xyz, uGridSize );
        qLocal = floor( ( qLocal + qPhase ) / uGridSize + 0.5 ) * uGridSize - qPhase;
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
      worldPosition.xyz = quantizeWorldPos(worldPosition.xyz);
    #endif
  `;

  /**
   * Patch a standard Three.js material to quantize vertices in world space.
   * Safe to call multiple times on the same material (idempotent).
   *
   * `gridSize` overrides the global grid size for this material (fixed at
   * first patch; later calls can only update the value of an existing
   * override). Omit it to follow the shared global uniform.
   */
  export const patchMaterial = (material: THREE.Material, gridSize?: number): void => {
    const existing = (material as any).__quantizationUniform as THREE.IUniform<number> | undefined;
    if (existing) {
      if (gridSize !== undefined && existing !== uniforms.uGridSize) existing.value = gridSize;
      return;
    }

    const uniform: THREE.IUniform<number> =
      gridSize !== undefined ? { value: gridSize } : uniforms.uGridSize;

    const originalCacheKey = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => (originalCacheKey?.() ?? "") + "_quantized";

    // Chain after any pre-existing onBeforeCompile (same pattern as
    // lampGlow's patch) — assigning directly silently discarded another
    // patch's shader edits when quantization was applied second.
    const prevOnBeforeCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prevOnBeforeCompile?.call(material, shader, renderer);
      shader.uniforms.uGridSize = uniform;

      // Inject quantize function before main()
      shader.vertexShader = shader.vertexShader.replace(
        "void main() {",
        QUANTIZE_GLSL + "\nvoid main() {",
      );

      // Replace project_vertex to quantize clip-space output
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        PROJECT_VERTEX_REPLACEMENT,
      );

      // Replace worldpos_vertex for shadow/envmap consistency
      shader.vertexShader = shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        WORLDPOS_VERTEX_REPLACEMENT,
      );
    };

    (material as any).__quantizationUniform = uniform;
    material.needsUpdate = true;
  };

  /** Set the global grid size. 0 = quantization disabled. */
  export const setGridSize = (size: number): void => {
    uniforms.uGridSize.value = size;
  };
}
