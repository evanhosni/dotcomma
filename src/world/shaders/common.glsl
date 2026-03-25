// ── Shared procedural noise ──

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    value += amplitude * valueNoise(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// ── Triplanar sampling ──

vec4 triplanarSample(sampler2D tex, vec3 worldPos, vec3 worldNormal, float scale) {
  vec3 blending = abs(worldNormal);
  blending = normalize(max(blending, 0.00001));
  float b = blending.x + blending.y + blending.z;
  blending /= b;

  vec4 xaxis = texture2D(tex, worldPos.yz * scale);
  vec4 yaxis = texture2D(tex, worldPos.xz * scale);
  vec4 zaxis = texture2D(tex, worldPos.xy * scale);

  return xaxis * blending.x + yaxis * blending.y + zaxis * blending.z;
}
