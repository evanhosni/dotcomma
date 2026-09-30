uniform sampler2D salttexture;
varying vec2 vWorldUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;

void main() {
  // Cracked pale crust: the sidewalk tile read as bleached plates, with a faint blue-white glare.
  vec3 crust = texture2D(salttexture, fract(vWorldUv * 0.6)).rgb;
  vec3 color = mix(vec3(0.93, 0.92, 0.88), crust * vec3(1.0, 0.99, 0.95), 0.35);
  float sheen = worldFbm(vWorldPosWrapped.xz, 0.005, 2);
  color *= 0.94 + 0.12 * sheen;
  gl_FragColor = vec4(color, 1.0);
}
