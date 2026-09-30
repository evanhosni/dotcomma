uniform sampler2D grasstexture;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;

void main() {
  vec2 adjustedUV = fract(vWorldUv);
  float tri = smoothstep(0.3, 0.6, vSlopeAngle);
  vec4 c = tri < 0.01
    ? texture2D(grasstexture, adjustedUV)
    : mix(texture2D(grasstexture, adjustedUV), triplanarSample(grasstexture, vWorldPosWrapped, vWorldNormal, 1.0 / 26.25), tri);
  gl_FragColor = c;
}
