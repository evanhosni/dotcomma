uniform sampler2D grasstexture;
uniform sampler2D grassdirttexture;
uniform sampler2D dirttexture;
varying vec2 vUv;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying float vHeight;
varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;

void main() {
  vec2 adjustedUV = fract(vWorldUv);
  float texScale = 1.0 / 26.25;

  // One octave: it only nudges the slope threshold by ±0.05; three cost 12 sin() per fragment.
  float largeNoise = worldFbm(vWorldPosWrapped.xz, 0.005, 1);
  float noiseOffset = (largeNoise - 0.5) * 0.1;
  float heightFactor = smoothstep(30.0, 150.0, vHeight) * 0.3;
  float effectiveSlope = vSlopeAngle + noiseOffset + heightFactor;

  float grassWeight = 1.0 - smoothstep(0.15, 0.25, effectiveSlope);
  float dirtWeight = smoothstep(0.45, 0.7, effectiveSlope);
  float grassDirtWeight = max(1.0 - grassWeight - dirtWeight, 0.0);
  float totalWeight = grassWeight + grassDirtWeight + dirtWeight;
  if (totalWeight > 0.0) { grassWeight /= totalWeight; grassDirtWeight /= totalWeight; dirtWeight /= totalWeight; }

  // Sample each layer only where its weight is visible (up to 3 triplanar reads each).
  float tri = smoothstep(0.3, 0.6, vSlopeAngle);
  vec4 terrainColor = vec4(0.0);
  if (grassWeight > 0.002) {
    vec4 gc = tri < 0.01 ? texture2D(grasstexture, adjustedUV) : mix(texture2D(grasstexture, adjustedUV), triplanarSample(grasstexture, vWorldPosWrapped, vWorldNormal, texScale), tri);
    terrainColor += gc * grassWeight;
  }
  if (grassDirtWeight > 0.002) {
    vec4 gdc = tri < 0.01 ? texture2D(grassdirttexture, adjustedUV) : mix(texture2D(grassdirttexture, adjustedUV), triplanarSample(grassdirttexture, vWorldPosWrapped, vWorldNormal, texScale), tri);
    terrainColor += gdc * grassDirtWeight;
  }
  if (dirtWeight > 0.002) {
    vec4 dc = tri < 0.01 ? texture2D(dirttexture, adjustedUV) : mix(texture2D(dirttexture, adjustedUV), triplanarSample(dirttexture, vWorldPosWrapped, vWorldNormal, texScale), tri);
    terrainColor += dc * dirtWeight;
  }

  gl_FragColor = terrainColor;
}
