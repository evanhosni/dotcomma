float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

/** Value noise repeating every `period` cells — vWorldPosWrapped is wrapped to
 *  WORLD_WRAP, so a non-repeating lattice would seam every 4200 units. */
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

/** FBM over the WRAPPED world XZ. `WORLD_WRAP * scale` must be a whole number
 *  of cells (0.005 → 21). Raw absolute coordinates would push hash()'s sin()
 *  past float32 resolution and band far from the origin. */
float worldFbm(vec2 worldXZ, float scale, int octaves) {
  vec2 p = worldXZ * scale;
  float period = WORLD_WRAP * scale;
  // Straight-line, not a loop: a constant `octaves` of 1 made ANGLE warn
  // "X3557: loop only executes for 1 iteration(s)" on every compile.
  float value = 0.5 * valueNoise(p, period);
  if (octaves > 1) { p *= 2.0; period *= 2.0; value += 0.25 * valueNoise(p, period); }
  if (octaves > 2) { p *= 2.0; period *= 2.0; value += 0.125 * valueNoise(p, period); }
  if (octaves > 3) { p *= 2.0; period *= 2.0; value += 0.0625 * valueNoise(p, period); }
  return value;
}

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
