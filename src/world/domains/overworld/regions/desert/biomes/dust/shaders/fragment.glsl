uniform sampler2D sandtexture;
varying vec2 vUv;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;

void main() {
  vec2 adjustedUV = fract(vWorldUv);
  float texScale = 1.0 / 26.25;

  float tri = smoothstep(0.3, 0.6, vSlopeAngle);
  vec4 terrainColor = tri < 0.01
    ? texture2D(sandtexture, adjustedUV)
    : mix(texture2D(sandtexture, adjustedUV), triplanarSample(sandtexture, vWorldPosWrapped, vWorldNormal, texScale), tri);

  gl_FragColor = terrainColor;
}
