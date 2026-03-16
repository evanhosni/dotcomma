varying float vDistanceToBiomeBoundaryCenter;
varying float vDistanceToRegionBoundaryCenter;
uniform sampler2D regiontexture;
uniform sampler2D biometexture;
uniform sampler2D grasstexture;
varying vec2 vUv;
varying vec2 vWorldUv;

void main() {
  vec2 adjustedUV = fract(vWorldUv);

  // Use region boundary texture if near region boundary, else biome boundary texture, else grass
  vec4 baseColor;
  float blendFactor;

  if (vDistanceToRegionBoundaryCenter < 14.0) {
    baseColor = texture2D(regiontexture, adjustedUV);
    blendFactor = smoothstep(12.0, 14.0, vDistanceToRegionBoundaryCenter);
  } else if (vDistanceToBiomeBoundaryCenter < 14.0) {
    baseColor = texture2D(biometexture, adjustedUV);
    blendFactor = smoothstep(12.0, 14.0, vDistanceToBiomeBoundaryCenter);
  } else {
    baseColor = texture2D(grasstexture, adjustedUV);
    blendFactor = 1.0;
  }

  gl_FragColor = mix(baseColor, texture2D(grasstexture, adjustedUV), blendFactor);
}
