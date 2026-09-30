uniform sampler2D rocktexture;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying float vHeight;
varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;

void main() {
  // Gray rock on the steep faces, snow settling on anything flat and high.
  vec3 rock = triplanarSample(rocktexture, vWorldPosWrapped, vWorldNormal, 1.0 / 26.25).rgb * vec3(0.62, 0.62, 0.66);
  float grain = worldFbm(vWorldPosWrapped.xz, 0.04, 2);
  float snowCover = (1.0 - smoothstep(0.18, 0.42, vSlopeAngle + (grain - 0.5) * 0.15)) * smoothstep(20.0, 120.0, vHeight);
  vec3 snow = mix(vec3(0.88, 0.91, 0.96), vec3(0.98, 0.99, 1.0), grain);
  vec3 color = mix(rock, snow, snowCover);
  float shade = 0.6 + 0.4 * clamp(dot(normalize(vWorldNormal), normalize(vec3(0.35, 0.9, 0.2))), 0.0, 1.0);
  gl_FragColor = vec4(color * shade / 0.96, 1.0);
}
