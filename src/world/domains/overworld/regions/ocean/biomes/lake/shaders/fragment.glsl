uniform sampler2D lakebedtexture;
varying vec2 vWorldUv;
varying vec3 vWorldPosWrapped;

void main() {
  // Silty lake bed, darker toward the middle (the water above adds the blue).
  vec3 bed = texture2D(lakebedtexture, fract(vWorldUv)).rgb;
  float silt = worldFbm(vWorldPosWrapped.xz, 0.02, 2);
  gl_FragColor = vec4(bed * mix(vec3(0.45, 0.5, 0.5), vec3(0.7, 0.72, 0.68), silt), 1.0);
}
