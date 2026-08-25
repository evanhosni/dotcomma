varying float vDistanceToBiomeBoundaryCenter;
uniform sampler2D biometexture;
uniform sampler2D sandtexture;
varying vec2 vUv;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec2 adjustedUV = fract(vWorldUv);
  float texScale = 1.0 / 26.25;

  // ── Terrain texture (triplanar on steep slopes) ──
  float tri = smoothstep(0.3, 0.6, vSlopeAngle);
  vec4 terrainColor = tri < 0.01
    ? texture2D(sandtexture, adjustedUV)
    : mix(texture2D(sandtexture, adjustedUV), triplanarSample(sandtexture, vWorldPos, vWorldNormal, texScale), tri);

  // ── Biome boundary blending ──
  vec4 biomeColor;

  if (vDistanceToBiomeBoundaryCenter < BOUNDARY_WIDTH) {
    vec4 baseColor = texture2D(biometexture, adjustedUV);
    float blendFactor = smoothstep(BOUNDARY_WIDTH - 2.0, BOUNDARY_WIDTH, vDistanceToBiomeBoundaryCenter);
    biomeColor = mix(baseColor, terrainColor, blendFactor);
  } else {
    biomeColor = terrainColor;
  }

  gl_FragColor = biomeColor;
}
