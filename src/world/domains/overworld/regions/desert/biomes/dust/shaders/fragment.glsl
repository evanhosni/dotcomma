uniform sampler2D sandtexture;
varying vec2 vUv;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;

void main() {
  vec2 adjustedUV = fract(vWorldUv);
  float tri = smoothstep(0.3, 0.6, vSlopeAngle);
  gl_FragColor = slopeBlendedSample(sandtexture, adjustedUV, tri, vWorldPosWrapped, vWorldNormal, 1.0 / TEXTURE_TILE);
}
