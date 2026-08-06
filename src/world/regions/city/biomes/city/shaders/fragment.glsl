varying float vDistanceToBiomeBoundaryCenter;
varying float vDistanceToRoadCenter;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
uniform sampler2D biometexture;
uniform sampler2D roadtexture;
uniform sampler2D sidewalktexture;
varying vec2 vUv;
varying vec2 vWorldUv;

void main() {
  vec2 adjustedUV = fract(vWorldUv);
  float roadDist = vDistanceToRoadCenter;

  // Band layout in STREET units (cityConfig.roadWidth = 7). The road field
  // is normalized in vertexCompute, so freeways use the same bands stretched
  // by freewayWidth / roadWidth.
  //   0..7      road asphalt (curb dip is baked into the heightfield)
  //   7..8      curb strip
  //   8..12     sidewalk
  //   12+       block interior (poured-concrete lots/plazas)

  // ── Road ──
  // (No painted centerline — raised pavement markers are real 3D instances,
  // see objects/road-markers/RoadMarkers.tsx.)
  vec4 roadColor = texture2D(roadtexture, adjustedUV);

  // Gutter darkening against the curb
  float gutter = smoothstep(5.4, 7.0, roadDist) * (1.0 - smoothstep(7.0, 7.6, roadDist));
  roadColor.rgb *= 1.0 - gutter * 0.25;

  // ── Curb / sidewalk / block interior ──
  vec4 sidewalkColor = texture2D(sidewalktexture, adjustedUV);
  vec3 curbColor = min(sidewalkColor.rgb * 1.3, vec3(1.0));
  vec3 interiorColor = texture2D(sidewalktexture, fract(vWorldUv * 0.35)).rgb * vec3(0.8, 0.79, 0.77);

  vec3 groundColor = mix(roadColor.rgb, curbColor, smoothstep(6.7, 7.5, roadDist));
  groundColor = mix(groundColor, sidewalkColor.rgb, smoothstep(7.9, 8.9, roadDist));
  groundColor = mix(groundColor, interiorColor, smoothstep(12.0, 14.2, roadDist));

  // Biome boundary: ring road around the biome edge
  if (vDistanceToBiomeBoundaryCenter < 14.0) {
    groundColor = texture2D(biometexture, adjustedUV).rgb;
  }

  // Fake directional shading so plateau ramps and curb dips read on the
  // unlit terrain (normalized to ~1.0 on flat ground).
  float shade = 0.62 + 0.38 * clamp(dot(normalize(vWorldNormal), normalize(vec3(0.35, 0.9, 0.2))), 0.0, 1.0);
  groundColor *= shade / 0.967;

  gl_FragColor = vec4(groundColor, 1.0);
}
