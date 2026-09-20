varying float vDistanceToBiomeBoundaryCenter;
varying float vDistanceToRoadCenter;
varying float vDistanceToFreewayCenter;
varying float vFreewayAlong;
varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;
uniform sampler2D biometexture;
uniform sampler2D roadtexture;
uniform sampler2D sidewalktexture;
varying vec2 vUv;
varying vec2 vWorldUv;

void main() {
  vec2 adjustedUV = fract(vWorldUv);
  float roadDist = vDistanceToRoadCenter;

  // Bands in STREET units from the centerline (freeways reuse them stretched):
  //   0..R asphalt | R..R+1 curb | R+1..R+5 sidewalk | R+5+ block interior
  float R = ROAD_HALF_WIDTH;

  vec4 roadColor = texture2D(roadtexture, adjustedUV);

  float gutter = smoothstep(R - 1.6, R, roadDist) * (1.0 - smoothstep(R, R + 0.6, roadDist));
  roadColor.rgb *= 1.0 - gutter * 0.25;

  vec4 sidewalkColor = texture2D(sidewalktexture, adjustedUV);
  vec3 curbColor = min(sidewalkColor.rgb * 1.3, vec3(1.0));
  vec3 interiorColor = texture2D(sidewalktexture, fract(vWorldUv * 0.35)).rgb * vec3(0.8, 0.79, 0.77);

  vec3 groundColor = mix(roadColor.rgb, curbColor, smoothstep(R - 0.3, R + 0.5, roadDist));
  groundColor = mix(groundColor, sidewalkColor.rgb, smoothstep(R + 0.9, R + 1.9, roadDist));
  groundColor = mix(groundColor, interiorColor, smoothstep(R + 5.0, R + 7.2, roadDist));

  // Freeway dashed lane lines. Both varyings JUMP between vertices at wall
  // seams / axis switches, where interpolation sweeps mod() into zebra
  // stripes — the fwidth guard drops paint on those slivers (healthy ≈ 1).
  float worldPx = max(fwidth(vWorldPosWrapped.x) + fwidth(vWorldPosWrapped.z), 1e-4);
  float seamOk = step(fwidth(vFreewayAlong) / worldPx, 4.0) *
                 step(fwidth(vDistanceToFreewayCenter) / worldPx, 4.0);
  // REAL units here, unlike R above.
  float laneLine = 1.0 - smoothstep(0.22, 0.4, abs(vDistanceToFreewayCenter - FREEWAY_HALF_WIDTH * 0.5));
  float laneDash = step(mod(vFreewayAlong, 10.0), 5.0);
  groundColor = mix(groundColor, vec3(0.82, 0.82, 0.8), laneLine * laneDash * seamOk * 0.52);

  if (vDistanceToBiomeBoundaryCenter < BOUNDARY_WIDTH) {
    groundColor = texture2D(biometexture, adjustedUV).rgb;
  }

  // Fake directional shading so ramps and curbs read on the unlit terrain (~1.0 on flat ground).
  float shade = 0.62 + 0.38 * clamp(dot(normalize(vWorldNormal), normalize(vec3(0.35, 0.9, 0.2))), 0.0, 1.0);
  groundColor *= shade / 0.967;

  gl_FragColor = vec4(groundColor, 1.0);
}
