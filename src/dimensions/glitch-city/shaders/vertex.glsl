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

void main() {
  vDistanceToBiomeBoundaryCenter = distanceToBiomeBoundaryCenter;
  vDistanceToRegionBoundaryCenter = distanceToRegionBoundaryCenter;
  vDistanceToRoadCenter = distanceToRoadCenter;
  vBiomeId = int(biomeId);
  vUv = uv;
  vWorldUv = (modelMatrix * vec4(position, 1.0)).xz / 26.25;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
