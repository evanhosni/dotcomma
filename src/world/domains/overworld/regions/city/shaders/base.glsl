uniform sampler2D grasstexture;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;

void main() {
  float tri = smoothstep(0.3, 0.6, vSlopeAngle);
  gl_FragColor = slopeBlendedSample(grasstexture, vWorldUv, tri, vWorldPosWrapped, vWorldNormal, 1.0 / TEXTURE_TILE);
}
