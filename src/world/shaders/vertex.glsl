attribute float distanceToBiomeBoundaryCenter;
attribute float distanceToRegionBoundaryCenter;
attribute float distanceToRoadCenter;
varying float vDistanceToBiomeBoundaryCenter;
varying float vDistanceToRegionBoundaryCenter;
varying float vDistanceToRoadCenter;
attribute float biomeId;
flat varying int vBiomeId;
varying vec2 vUv;
varying vec2 vWorldUv;

uniform float uGridSize;

vec3 quantizeWorldPos(vec3 worldPos) {
  if (uGridSize <= 0.0) return worldPos;
  return floor(worldPos / uGridSize + 0.5) * uGridSize;
}

void main() {
  vDistanceToBiomeBoundaryCenter = distanceToBiomeBoundaryCenter;
  vDistanceToRegionBoundaryCenter = distanceToRegionBoundaryCenter;
  vDistanceToRoadCenter = distanceToRoadCenter;
  vBiomeId = int(biomeId);
  vUv = uv;

  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  worldPos.xyz = quantizeWorldPos(worldPos.xyz);

  vWorldUv = worldPos.xz / 26.25;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
