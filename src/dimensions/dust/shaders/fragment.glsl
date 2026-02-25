varying float vDistanceToBiomeBoundaryCenter;
varying float vDistanceToRegionBoundaryCenter;
uniform sampler2D regiontexture;
uniform sampler2D biometexture;
uniform sampler2D sandtexture;
varying vec2 vUv;

void main() {
  vec2 adjustedUV = fract(vUv * 16.0);

  // Use region boundary texture if near region boundary, else biome boundary texture, else sand
  vec4 baseColor;
  float blendFactor;

  if (vDistanceToRegionBoundaryCenter < 14.0) {
    baseColor = texture2D(regiontexture, adjustedUV);
    blendFactor = smoothstep(12.0, 14.0, vDistanceToRegionBoundaryCenter);
  } else if (vDistanceToBiomeBoundaryCenter < 14.0) {
    baseColor = texture2D(biometexture, adjustedUV);
    blendFactor = smoothstep(12.0, 14.0, vDistanceToBiomeBoundaryCenter);
  } else {
    baseColor = texture2D(sandtexture, adjustedUV);
    blendFactor = 1.0;
  }

  gl_FragColor = mix(baseColor, texture2D(sandtexture, adjustedUV), blendFactor);
}
