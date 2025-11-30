varying float vDistanceToRoadCenter;
uniform sampler2D roadtexture;
uniform sampler2D sandtexture;
varying vec2 vUv;

void main() {
  vec2 adjustedUV = fract(vUv * 16.0);
  float blendFactor = smoothstep(12.0, 14.0, vDistanceToRoadCenter);
  gl_FragColor = mix(texture2D(roadtexture, adjustedUV), texture2D(sandtexture, adjustedUV), blendFactor);
}
