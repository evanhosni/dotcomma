uniform sampler2D lakesandtexture;
varying vec2 vWorldUv;
varying vec3 vWorldPosWrapped;
varying float vUnderwaterDepth;

void main() {
  // Sea-floor sand, darkening and cooling with the water over it (the water above adds the blue).
  vec3 sand = texture2D(lakesandtexture, fract(vWorldUv)).rgb;
  float ripple = worldFbm(vWorldPosWrapped.xz, 0.03, 2);
  float deep = smoothstep(0.0, 24.0, vUnderwaterDepth);
  vec3 tint = mix(vec3(0.95, 0.9, 0.8), vec3(0.3, 0.33, 0.36), deep);
  gl_FragColor = vec4(sand * tint * mix(0.85, 1.05, ripple), 1.0);
}
