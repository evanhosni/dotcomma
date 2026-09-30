uniform sampler2D shoretexture;
varying vec2 vWorldUv;
varying vec3 vWorldPosWrapped;

void main() {
  // Wet shore sand: the sand tile, darkened and cooled, with damp streaks.
  vec3 sand = texture2D(shoretexture, fract(vWorldUv)).rgb;
  float damp = worldFbm(vWorldPosWrapped.xz, 0.015, 2);
  vec3 color = sand * mix(vec3(0.55, 0.52, 0.48), vec3(0.75, 0.72, 0.66), damp);
  gl_FragColor = vec4(color, 1.0);
}
