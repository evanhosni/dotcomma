attribute float distanceToBiomeBoundaryCenter;
attribute float distanceToRiverCenter;
attribute float distanceToRoadCenter;
varying float vDistanceToBiomeBoundaryCenter;
varying float vDistanceToRiverCenter;
varying float vDistanceToRoadCenter;
attribute float biomeId;
flat varying int vBiomeId;
varying vec2 vUv;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying float vHeight;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

uniform float uGridSize;

vec3 quantizeWorldPos(vec3 worldPos) {
  if (uGridSize <= 0.0) return worldPos;
  return floor(worldPos / uGridSize + 0.5) * uGridSize;
}

void main() {
  vDistanceToBiomeBoundaryCenter = distanceToBiomeBoundaryCenter;
  vDistanceToRiverCenter = distanceToRiverCenter;
  vDistanceToRoadCenter = distanceToRoadCenter;
  vBiomeId = int(biomeId);
  vUv = uv;

  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  worldPos.xyz = quantizeWorldPos(worldPos.xyz);

  vWorldUv = worldPos.xz / 26.25;
  vWorldPos = worldPos.xyz;

  vec3 worldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  vWorldNormal = worldNormal;
  vSlopeAngle = 1.0 - abs(worldNormal.y);
  vHeight = worldPos.y;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
