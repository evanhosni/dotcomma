import * as THREE from "three";

export namespace _quantization {
  export const uniforms = {
    uGridSize: { value: 0.0 } as THREE.IUniform<number>,
  };

  /** Injected before main() in patched materials and interpolated into the custom terrain/foliage shaders, so the function exists once. */
  export const QUANTIZE_GLSL = /* glsl */ `
    uniform float uGridSize;

    vec3 quantizeWorldPos(vec3 worldPos) {
      if (uGridSize <= 0.0) return worldPos;
      return floor(worldPos / uGridSize + 0.5) * uGridSize;
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

    const originalCacheKey = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => (originalCacheKey?.() ?? "") + "_quantized";

    // Chain, don't assign: assigning discarded lampGlow's shader edits when quantization was applied second.
    const prevOnBeforeCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prevOnBeforeCompile?.call(material, shader, renderer);
      shader.uniforms.uGridSize = uniform;

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
    };

    (material as any).__quantizationUniform = uniform;
    material.needsUpdate = true;
  };

  /** Set the global grid size. 0 = quantization disabled. */
  export const setGridSize = (size: number): void => {
    uniforms.uGridSize.value = size;
  };
}
