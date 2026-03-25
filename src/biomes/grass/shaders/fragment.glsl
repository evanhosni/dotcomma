varying float vDistanceToBiomeBoundaryCenter;
uniform sampler2D biometexture;
uniform sampler2D grasstexture;
uniform sampler2D grassdirttexture;
uniform sampler2D dirttexture;
varying vec2 vUv;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying float vHeight;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vec2 adjustedUV = fract(vWorldUv);
  float texScale = 1.0 / 26.25;

  // ── Terrain texture (slope-based blending + triplanar) ──
  float largeNoise = fbm(vWorldPos.xz * 0.005, 3);
  float noiseOffset = (largeNoise - 0.5) * 0.1;
  float heightFactor = smoothstep(30.0, 150.0, vHeight) * 0.3;
  float effectiveSlope = vSlopeAngle + noiseOffset + heightFactor;

  float grassWeight = 1.0 - smoothstep(0.15, 0.25, effectiveSlope);
  float dirtWeight = smoothstep(0.45, 0.7, effectiveSlope);
  float grassDirtWeight = max(1.0 - grassWeight - dirtWeight, 0.0);
  float totalWeight = grassWeight + grassDirtWeight + dirtWeight;
  if (totalWeight > 0.0) { grassWeight /= totalWeight; grassDirtWeight /= totalWeight; dirtWeight /= totalWeight; }

  float tri = smoothstep(0.3, 0.6, vSlopeAngle);
  vec4 gc = tri < 0.01 ? texture2D(grasstexture, adjustedUV) : mix(texture2D(grasstexture, adjustedUV), triplanarSample(grasstexture, vWorldPos, vWorldNormal, texScale), tri);
  vec4 gdc = tri < 0.01 ? texture2D(grassdirttexture, adjustedUV) : mix(texture2D(grassdirttexture, adjustedUV), triplanarSample(grassdirttexture, vWorldPos, vWorldNormal, texScale), tri);
  vec4 dc = tri < 0.01 ? texture2D(dirttexture, adjustedUV) : mix(texture2D(dirttexture, adjustedUV), triplanarSample(dirttexture, vWorldPos, vWorldNormal, texScale), tri);
  vec4 terrainColor = gc * grassWeight + gdc * grassDirtWeight + dc * dirtWeight;

  // ── Biome boundary blending ──
  vec4 biomeColor;

  if (vDistanceToBiomeBoundaryCenter < 14.0) {
    vec4 baseColor = texture2D(biometexture, adjustedUV);
    float blendFactor = smoothstep(12.0, 14.0, vDistanceToBiomeBoundaryCenter);
    biomeColor = mix(baseColor, terrainColor, blendFactor);
  } else {
    biomeColor = terrainColor;
  }

  gl_FragColor = biomeColor;
}
