varying float vDistanceToBiomeBoundaryCenter;
varying float vDistanceToRoadCenter;
uniform sampler2D biometexture;
uniform sampler2D roadtexture;
uniform sampler2D sidewalktexture;
varying vec2 vUv;
varying vec2 vWorldUv;

void main() {
  vec2 adjustedUV = fract(vWorldUv);

  // Sidewalk / block texture
  vec4 sidewalkColor = texture2D(biometexture, adjustedUV);
  vec4 roadColor = texture2D(roadtexture, adjustedUV);
  float sidewalkBlend = smoothstep(14.0, 16.0, vDistanceToRoadCenter);
  vec4 blockColor = mix(roadColor, sidewalkColor, sidewalkBlend);

  // Biome boundary blending
  vec4 biomeColor;
  if (vDistanceToBiomeBoundaryCenter < 14.0) {
    vec4 biomeTexColor = texture2D(biometexture, adjustedUV);
    biomeColor = biomeTexColor;
  } else {
    biomeColor = blockColor;
  }

  gl_FragColor = biomeColor;
}
