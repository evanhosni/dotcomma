varying float vDistanceToRoadCenter;
uniform sampler2D roadtexture;
uniform sampler2D sidewalktexture;
varying vec2 vUv;

void main() {
  vec2 adjustedUV = fract(vUv * 16.0);
  float blendFactorRoad = smoothstep(14.0, 16.0, vDistanceToRoadCenter);

  vec4 blockTexture = mix(texture2D(roadtexture, adjustedUV), texture2D(sidewalktexture, adjustedUV), 0.5);
  gl_FragColor = mix(texture2D(roadtexture, adjustedUV), blockTexture, blendFactorRoad);
}
