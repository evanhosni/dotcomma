uniform sampler2D sandtexture;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;

void main() {
  float tri = smoothstep(0.3, 0.6, vSlopeAngle);
  vec4 c = slopeBlendedSample(sandtexture, vWorldUv, tri, vWorldPosWrapped, vWorldNormal, 1.0 / TEXTURE_TILE);
  // Dust's sand, bleached a step paler: the oasis shares dust's relief, so its color is what tells it apart.
  gl_FragColor = vec4(mix(c.rgb, vec3(1.0, 0.97, 0.9), 0.28), 1.0);
}
