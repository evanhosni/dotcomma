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
varying vec3 vWorldPos;
varying vec3 vWorldPosAbs;

uniform float uGridSize;

// ── Distance-from-origin precision ───────────────────────────────────────
// NOTHING in this shader may form an ABSOLUTE world coordinate. GLSL is
// float32: its resolution is ~0.008u at 100k units from the world origin and
// ~0.06u at 1M. That is enough to (a) swamp the 0.025u quantization grid, so
// vertices flip lattice cells every frame and the terrain visibly swims,
// (b) stair-step world-space texture UVs, and (c) blow up the city shader's
// fwidth() seam guards, which compare a varying's gradient against the
// world-space gradient of vWorldPos. Past ~420k units `worldPos / 0.025`
// leaves float32's exact-integer range entirely and the quantization
// collapses into garbage geometry.
//
// So world position is built as (WRAPPED chunk origin + offset from that
// origin). mat3() drops the translation, so the offset is chunk-sized and
// exact wherever the chunk is, and modelViewMatrix[3] gives the chunk origin
// in VIEW space already resolved on the CPU in float64.
//
// WORLD_WRAP is a common multiple of every world-space period downstream —
// the 26.25u texture tile (×160), the 75u sidewalk tile (×56), the 200u fbm
// cell (×21) — and of both quantization grids (0.025 ×168000, 0.2 ×21000),
// so the wrap is INVISIBLE: fract()/tiling land on identical values and the
// quantization lattice keeps its world phase. Chunk centers are always
// multiples of 210 (=WORLD_WRAP/20), which makes the mod() below exact.
// Anything new that reads vWorldPos with a world-space period must divide
// WORLD_WRAP, or it will seam every 4200 units.
#define WORLD_WRAP 4200.0

vec3 quantizeWorldPos(vec3 worldPos) {
  if (uGridSize <= 0.0) return worldPos;
  return floor(worldPos / uGridSize + 0.5) * uGridSize;
}

void main() {
  vDistanceToBiomeBoundaryCenter = distanceToBiomeBoundaryCenter;
  vDistanceToRiverCenter = distanceToRiverCenter;
  vDistanceToRoadCenter = distanceToRoadCenter;
  vDistanceToFreewayCenter = distanceToFreewayCenter;
  vFreewayAlong = freewayAlong;
  vBiomeId = int(biomeId);
  vUv = uv;

  vec3 chunkOrigin = modelMatrix[3].xyz;
  // Y is terrain height — already near 0, so it is left unwrapped and exact.
  vec3 wrapOrigin = vec3(mod(chunkOrigin.x, WORLD_WRAP), chunkOrigin.y, mod(chunkOrigin.z, WORLD_WRAP));
  vec3 localWorld = mat3(modelMatrix) * position;

  vec3 worldPos = quantizeWorldPos(wrapOrigin + localWorld);

  vWorldUv = worldPos.xz / 26.25;
  vWorldPos = worldPos;

  // TRUE (unwrapped) world position — ONLY for consumers that compare against
  // absolute positions computed on the CPU: the lamp-glow grid and the scene
  // point-light loop (comparing those against the WRAPPED vWorldPos aliased
  // the lighting onto the wrong chunks — lit/unlit tiles per wrap cell).
  // Float32 absolute error (~0.06u at 1M units) is far below any lighting
  // falloff scale. NEVER use this for tiling, quantization, or fwidth()
  // guards — that's what the wrapped vWorldPos above is for.
  vWorldPosAbs = chunkOrigin + localWorld;

  vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
  vWorldNormal = worldNormal;
  vSlopeAngle = 1.0 - abs(worldNormal.y);
  vHeight = worldPos.y;

  vec3 viewPos = modelViewMatrix[3].xyz + mat3(viewMatrix) * (worldPos - wrapOrigin);
  gl_Position = projectionMatrix * vec4(viewPos, 1.0);
}
