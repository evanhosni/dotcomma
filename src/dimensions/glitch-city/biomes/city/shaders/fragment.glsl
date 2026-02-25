varying float vDistanceToBiomeBoundaryCenter;
varying float vDistanceToRegionBoundaryCenter;
varying float vDistanceToRoadCenter;
uniform sampler2D regiontexture;
uniform sampler2D biometexture;
uniform sampler2D roadtexture;
uniform sampler2D sidewalktexture;
varying vec2 vUv;

void main() {
  vec2 adjustedUV = fract(vUv * 16.0);

  // Determine which texture to use based on distances
  vec4 baseTexture;
  float blendFactor;

  // If we're near a region boundary, use region boundary texture (no blend)
  if (vDistanceToRegionBoundaryCenter < 14.0) {
    baseTexture = texture2D(regiontexture, adjustedUV);
    blendFactor = 0.0;
  }
  // If we're near a biome boundary, use biome boundary texture (roads in CityRegion, no blend)
  else if (vDistanceToBiomeBoundaryCenter < 14.0) {
    baseTexture = texture2D(biometexture, adjustedUV);
    blendFactor = 0.0;
  }
  // Otherwise, if we're near an internal road, use road texture (blend with sidewalk)
  else if (vDistanceToRoadCenter < 14.0) {
    baseTexture = texture2D(roadtexture, adjustedUV);
    blendFactor = smoothstep(14.0, 16.0, vDistanceToRoadCenter);
  }
  // Otherwise, we're in city blocks
  else {
    baseTexture = texture2D(sidewalktexture, adjustedUV);
    blendFactor = 1.0;
  }

  vec4 blockTexture = mix(baseTexture, texture2D(sidewalktexture, adjustedUV), 0.5);
  gl_FragColor = mix(baseTexture, blockTexture, blendFactor);
}
