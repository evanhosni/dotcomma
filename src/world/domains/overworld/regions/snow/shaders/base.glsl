varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;

void main() {
  // Snow: a cool white with wind-packed variation and a soft directional shade.
  float drift = worldFbm(vWorldPosWrapped.xz, 0.02, 2);
  vec3 color = mix(vec3(0.86, 0.90, 0.96), vec3(0.97, 0.98, 1.0), drift);
  float shade = 0.7 + 0.3 * clamp(dot(normalize(vWorldNormal), normalize(vec3(0.35, 0.9, 0.2))), 0.0, 1.0);
  gl_FragColor = vec4(color * shade / 0.97, 1.0);
}
