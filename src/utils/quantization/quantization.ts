import * as THREE from "three";

export namespace _quantization {
  /** Shared uniform — single object reference used by all materials. */
  export const uniforms = {
    uGridSize: { value: 0.0 } as THREE.IUniform<number>,
  };

  /** GLSL function injected before main() in standard material vertex shaders. */
  const QUANTIZE_GLSL = /* glsl */ `
    uniform float uGridSize;

    vec3 quantizeWorldPos(vec3 worldPos) {
      if (uGridSize <= 0.0) return worldPos;
      return floor(worldPos / uGridSize + 0.5) * uGridSize;
    }
  `;

  /** Replacement for #include <project_vertex> — quantizes in world space. */
  const PROJECT_VERTEX_REPLACEMENT = /* glsl */ `
    vec4 mvPosition = vec4( transformed, 1.0 );

    #ifdef USE_INSTANCING
      mvPosition = instanceMatrix * mvPosition;
    #endif

    vec4 qWorldPos = modelMatrix * mvPosition;
    qWorldPos.xyz = quantizeWorldPos(qWorldPos.xyz);
    mvPosition = viewMatrix * qWorldPos;

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
   */
  export const patchMaterial = (material: THREE.Material): void => {
    if ((material as any).__quantizationPatched) return;

    const originalCacheKey = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => (originalCacheKey?.() ?? "") + "_quantized";

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uGridSize = uniforms.uGridSize;

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

    (material as any).__quantizationPatched = true;
    material.needsUpdate = true;
  };

  /** Set the global grid size. 0 = quantization disabled. */
  export const setGridSize = (size: number): void => {
    uniforms.uGridSize.value = size;
  };

  /** Get the current grid size. */
  export const getGridSize = (): number => {
    return uniforms.uGridSize.value;
  };
}
