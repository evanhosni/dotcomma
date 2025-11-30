attribute float distanceToRoadCenter;
varying float vDistanceToRoadCenter;
attribute float biomeId;
flat varying int vBiomeId;
varying vec2 vUv;

void main() {
  vDistanceToRoadCenter = distanceToRoadCenter;
  vBiomeId = int(biomeId);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
