attribute float distanceToBiomeBoundaryCenter;
attribute float distanceToRegionBoundaryCenter;
attribute float distanceToRoadCenter;
varying float vDistanceToBiomeBoundaryCenter;
varying float vDistanceToRegionBoundaryCenter;
varying float vDistanceToRoadCenter;
attribute float biomeId;
flat varying int vBiomeId;
varying vec2 vUv;

void main() {
  vDistanceToBiomeBoundaryCenter = distanceToBiomeBoundaryCenter;
  vDistanceToRegionBoundaryCenter = distanceToRegionBoundaryCenter;
  vDistanceToRoadCenter = distanceToRoadCenter;
  vBiomeId = int(biomeId);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
