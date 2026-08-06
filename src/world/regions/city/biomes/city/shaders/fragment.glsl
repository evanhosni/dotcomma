varying float vDistanceToBiomeBoundaryCenter;
varying float vDistanceToRoadCenter;
varying float vDistanceToFreewayCenter;
varying float vFreewayAlong;
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

  // Freeway lane paint: 4 lanes — raised markers stud the median (3D
  // instances), and each side splits with a white DASHED line at ± half the
  // freeway half-width (real units via vDistanceToFreewayCenter; junction
  // zones export "no paint" so lines end before interchanges). Dash phase
  // runs along vFreewayAlong (perpendicular dash ends). Wherever either
  // varying JUMPS between vertices (wall-segment seams, axis switches, mask
  // boundaries) interpolation would sweep mod() into zebra stripes — the
  // fwidth guards detect those slivers by their absurd world-space gradient
  // (healthy roads sit near 1) and drop the paint there.
  float worldPx = max(fwidth(vWorldPos.x) + fwidth(vWorldPos.z), 1e-4);
  float seamOk = step(fwidth(vFreewayAlong) / worldPx, 4.0) *
                 step(fwidth(vDistanceToFreewayCenter) / worldPx, 4.0);
  float laneLine = 1.0 - smoothstep(0.22, 0.4, abs(vDistanceToFreewayCenter - 7.0));
  float laneDash = step(mod(vFreewayAlong, 10.0), 5.0);
  groundColor = mix(groundColor, vec3(0.82, 0.82, 0.8), laneLine * laneDash * seamOk * 0.52);

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
