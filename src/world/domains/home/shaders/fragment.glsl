uniform float uCrtPower;
uniform vec3 uCrtLight;
uniform vec4 uCrtGlow; // rgb = color, w = intensity
uniform float uCrtGlowDistance;
varying vec3 vWorldPosAbs;

// The home grid's lines: black until the CRT powers on, then lit by its glow the way a lambert surface is
// by a point light (three's falloff: 1/d^2 windowed to the light's distance; / PI for the BRDF). The
// terrain's own point lighting is gated to the night, so the CRT's real light cannot do it.
void main() {
  vec3 toLight = uCrtLight - vWorldPosAbs;
  float d = max(length(toLight), 0.001);
  float edge = clamp(1.0 - pow(d / uCrtGlowDistance, 4.0), 0.0, 1.0);
  float ndotl = clamp(toLight.y / d, 0.0, 1.0);
  float irradiance = uCrtGlow.w * uCrtPower * ndotl * edge * edge / (d * d);
  gl_FragColor = vec4(uCrtGlow.rgb * irradiance / 3.14159265, 1.0);
}
