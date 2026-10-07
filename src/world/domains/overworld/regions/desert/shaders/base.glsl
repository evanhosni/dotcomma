uniform sampler2D sandtexture;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;

void main() {
  vec2 adjustedUV = fract(vWorldUv);
  float tri = smoothstep(0.3, 0.6, vSlopeAngle);
  vec4 c = slopeBlendedSample(sandtexture, adjustedUV, tri, vWorldPosWrapped, vWorldNormal, 1.0 / TEXTURE_TILE);
  // A shade paler and flatter than the dunes, so the biome reads as raised sand on bare ground.
  gl_FragColor = vec4(c.rgb * vec3(1.05, 1.02, 0.96), 1.0);
}
