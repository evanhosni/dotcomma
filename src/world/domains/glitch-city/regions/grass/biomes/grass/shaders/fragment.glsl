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
  // One fbm octave: the noise only nudges the slope threshold by ±0.05, and
  // three octaves cost 12 sin() per fragment across the whole biome.
  float largeNoise = worldFbm(vWorldPos.xz, 0.005, 1);
  float noiseOffset = (largeNoise - 0.5) * 0.1;
  float heightFactor = smoothstep(30.0, 150.0, vHeight) * 0.3;
  float effectiveSlope = vSlopeAngle + noiseOffset + heightFactor;

  float grassWeight = 1.0 - smoothstep(0.15, 0.25, effectiveSlope);
  float dirtWeight = smoothstep(0.45, 0.7, effectiveSlope);
  float grassDirtWeight = max(1.0 - grassWeight - dirtWeight, 0.0);
  float totalWeight = grassWeight + grassDirtWeight + dirtWeight;
  if (totalWeight > 0.0) { grassWeight /= totalWeight; grassDirtWeight /= totalWeight; dirtWeight /= totalWeight; }

  // Each layer is sampled only where its weight is visible: on flat ground
  // grassWeight is 1 and the other two samples (up to 3 triplanar reads
  // each on slopes) were fetched and multiplied by zero. The weights are
  // smooth, so the branches only diverge inside the transition bands.
  float tri = smoothstep(0.3, 0.6, vSlopeAngle);
  vec4 terrainColor = vec4(0.0);
  if (grassWeight > 0.002) {
    vec4 gc = tri < 0.01 ? texture2D(grasstexture, adjustedUV) : mix(texture2D(grasstexture, adjustedUV), triplanarSample(grasstexture, vWorldPos, vWorldNormal, texScale), tri);
    terrainColor += gc * grassWeight;
  }
  if (grassDirtWeight > 0.002) {
    vec4 gdc = tri < 0.01 ? texture2D(grassdirttexture, adjustedUV) : mix(texture2D(grassdirttexture, adjustedUV), triplanarSample(grassdirttexture, vWorldPos, vWorldNormal, texScale), tri);
    terrainColor += gdc * grassDirtWeight;
  }
  if (dirtWeight > 0.002) {
    vec4 dc = tri < 0.01 ? texture2D(dirttexture, adjustedUV) : mix(texture2D(dirttexture, adjustedUV), triplanarSample(dirttexture, vWorldPos, vWorldNormal, texScale), tri);
    terrainColor += dc * dirtWeight;
  }

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
