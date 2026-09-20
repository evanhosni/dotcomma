attribute float distanceToBiomeBoundaryCenter;
attribute float distanceToRiverCenter;
attribute float distanceToRoadCenter;
attribute float distanceToFreewayCenter;
attribute float freewayAlong;
varying float vDistanceToBiomeBoundaryCenter;
varying float vDistanceToRiverCenter;
varying float vDistanceToRoadCenter;
varying float vDistanceToFreewayCenter;
varying float vFreewayAlong;
attribute float biomeId;
flat varying int vBiomeId;
varying vec2 vUv;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying float vHeight;
varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;
varying vec3 vWorldPosAbs;

// quantizeWorldPos() / curveViewPos() and the WORLD_WRAP define are prepended
// by world/terrain/material.ts.
//
// PRECISION (see CLAUDE.md, Coordinate Precision): NEVER form an absolute
// world coordinate here — float32 swims the quantization grid past ~100k
// units. World position = WRAPPED chunk origin + chunk-local offset, projected
// through the CPU-resolved view-space origin. Any new world-space period read
// from vWorldPosWrapped must divide WORLD_WRAP or it seams every 4200 units.

void main() {
  vDistanceToBiomeBoundaryCenter = distanceToBiomeBoundaryCenter;
  vDistanceToRiverCenter = distanceToRiverCenter;
  vDistanceToRoadCenter = distanceToRoadCenter;
  vDistanceToFreewayCenter = distanceToFreewayCenter;
  vFreewayAlong = freewayAlong;
  vBiomeId = int(biomeId);
  vUv = uv;

  vec3 chunkOrigin = modelMatrix[3].xyz;
  vec3 wrapOrigin = vec3(mod(chunkOrigin.x, WORLD_WRAP), chunkOrigin.y, mod(chunkOrigin.z, WORLD_WRAP));
  vec3 localWorld = mat3(modelMatrix) * position;

  vec3 worldPos = quantizeWorldPos(wrapOrigin + localWorld);

  vWorldUv = worldPos.xz / 26.25;
  vWorldPosWrapped = worldPos;

  // Unwrapped: ONLY for comparing against CPU-side absolute positions (lamp
  // grid, point lights). Never for tiling, quantization or fwidth() guards.
  vWorldPosAbs = chunkOrigin + localWorld;

  vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
  vWorldNormal = worldNormal;
  vSlopeAngle = 1.0 - abs(worldNormal.y);
  vHeight = worldPos.y;

  vec3 viewPos = modelViewMatrix[3].xyz + mat3(viewMatrix) * (worldPos - wrapOrigin);
  gl_Position = projectionMatrix * vec4(curveViewPos(viewPos), 1.0);
}
