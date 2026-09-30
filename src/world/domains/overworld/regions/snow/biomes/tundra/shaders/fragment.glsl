uniform sampler2D tundrascrubtexture;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;

void main() {
  // Frozen ground: snow with patches of dead scrub breaking through on hummocks and slopes.
  float scrubNoise = worldFbm(vWorldPosWrapped.xz, 0.03, 3);
  float scrubWeight = smoothstep(0.55, 0.72, scrubNoise + vSlopeAngle * 0.5);
  vec3 snow = mix(vec3(0.84, 0.88, 0.94), vec3(0.95, 0.96, 0.99), worldFbm(vWorldPosWrapped.xz, 0.01, 2));
  vec3 scrub = texture2D(tundrascrubtexture, fract(vWorldUv)).rgb * vec3(0.8, 0.78, 0.7);
  vec3 color = mix(snow, scrub, scrubWeight);
  float shade = 0.7 + 0.3 * clamp(dot(normalize(vWorldNormal), normalize(vec3(0.35, 0.9, 0.2))), 0.0, 1.0);
  gl_FragColor = vec4(color * shade / 0.97, 1.0);
}
