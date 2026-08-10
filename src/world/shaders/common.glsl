// ── Shared procedural noise ──

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

/** Value noise on a REPEATING lattice — `period` is the cell count after
 *  which the pattern repeats. vWorldPos arrives wrapped to WORLD_WRAP (see
 *  vertex.glsl), so the lattice has to repeat on the matching period;
 *  otherwise two chunks that wrapped differently would land on different
 *  hash cells and the noise would seam every 4200 units. */
float valueNoise(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(mod(i, period));
  float b = hash(mod(i + vec2(1.0, 0.0), period));
  float c = hash(mod(i + vec2(0.0, 1.0), period));
  float d = hash(mod(i + vec2(1.0, 1.0), period));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** FBM over a WRAPPED world XZ position. `scale` converts world units to
 *  noise cells; the result repeats every WORLD_WRAP (4200) world units, which
 *  is exactly what keeps it continuous across the wrap. `WORLD_WRAP * scale`
 *  must come out a whole number of cells — pick scales like 0.005 (21 cells).
 *  Feeding raw absolute coordinates here instead would push hash()'s sin()
 *  argument past the point where float32 can resolve it, and the noise
 *  degenerates into banding far from the origin. */
float worldFbm(vec2 worldXZ, float scale, int octaves) {
  vec2 p = worldXZ * scale;
  float period = 4200.0 * scale;
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    value += amplitude * valueNoise(p, period);
    p *= 2.0;
    period *= 2.0;
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
