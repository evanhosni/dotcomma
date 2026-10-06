attribute vec4 biomeSdf0;
attribute vec4 biomeSdf1;
attribute vec4 biomePresence0;
attribute vec4 biomePresence1;
attribute vec4 riverbedSdf0;
attribute vec4 riverbedSdf1;
attribute float riverBedDistance;
attribute float distanceToRoadCenter;
attribute float distanceToFreewayCenter;
attribute float freewayAlong;
attribute float skirtDrop;
varying vec4 vBiomeSdf0;
varying vec4 vBiomeSdf1;
varying vec4 vBiomePresence0;
varying vec4 vBiomePresence1;
varying vec4 vRiverbedSdf0;
varying vec4 vRiverbedSdf1;
varying float vRiverBedDistance;
varying float vDistanceToRoadCenter;
varying float vDistanceToFreewayCenter;
varying float vFreewayAlong;
varying vec2 vUv;
varying vec2 vWorldUv;
varying float vSlopeAngle;
varying float vHeight;
varying vec3 vWorldNormal;
varying vec3 vWorldPosWrapped;
varying vec3 vWorldPosAbs;
varying float vSkirt;

// The opaque program and its LOD-fade twin must place a vertex on the same pixel: without the
// qualifier a fast-math compiler (Apple/Metal) may evaluate the position differently per program.
invariant gl_Position;

// quantizeWorldPos() / curveViewPos() and the WORLD_WRAP define are prepended
// by world/terrain/material.ts.
//
// BIOME BLEND: vBiomeSdf* carry a SIGNED DISTANCE per biome slot (scaled so ±1 is
// the feather edge) and vBiomePresence* the signed distance to the biome's OWN
// boundary in its blend widths — never a weight or an id. Signed distance
// interpolates linearly, so the fragment shader's smoothsteps land a 1–3u feather
// at pixel resolution even on 17.5u quads (a per-triangle `flat` biome id would
// draw staircase edges and stray outlines at every wall).
//
// PRECISION (see CLAUDE.md, Coordinate Precision): NEVER form an absolute
// world coordinate here — float32 swims the quantization grid past ~100k
// units. World position = WRAPPED chunk origin + chunk-local offset, projected
// through the CPU-resolved view-space origin. Any new world-space period read
// from vWorldPosWrapped must divide WORLD_WRAP or it seams every 4200 units.

void main() {
  vBiomeSdf0 = biomeSdf0;
  vBiomeSdf1 = biomeSdf1;
  vBiomePresence0 = biomePresence0;
  vBiomePresence1 = biomePresence1;
  vRiverbedSdf0 = riverbedSdf0;
  vRiverbedSdf1 = riverbedSdf1;
  vRiverBedDistance = riverBedDistance;
  vDistanceToRoadCenter = distanceToRoadCenter;
  vDistanceToFreewayCenter = distanceToFreewayCenter;
  vFreewayAlong = freewayAlong;
  vUv = uv;

  vec3 chunkOrigin = modelMatrix[3].xyz;
  vec3 wrapOrigin = vec3(mod(chunkOrigin.x, WORLD_WRAP), chunkOrigin.y, mod(chunkOrigin.z, WORLD_WRAP));
  vec3 localWorld = mat3(modelMatrix) * position;

  vec3 worldPos = quantizeWorldPos(wrapOrigin + localWorld);

  // A SKIRT is shaded at the edge it hangs from (every attribute is already the edge's copy), so
  // where a seam's gap or crack shows it, it reads as that ground. Shaded at its own depth (up to
  // 1000u below) it was not: height-based paint (the mountain's snow line) drew it as rock.
  vec3 shadeLift = vec3(0.0, skirtDrop, 0.0);
  vec3 shadePos = worldPos + shadeLift;
  vSkirt = skirtDrop > 0.0 ? 1.0 : 0.0;

  vWorldUv = shadePos.xz / TEXTURE_TILE;
  vWorldPosWrapped = shadePos;

  // Unwrapped: ONLY for comparing against CPU-side absolute positions (lamp
  // grid, point lights). Never for tiling, quantization or fwidth() guards.
  vWorldPosAbs = chunkOrigin + localWorld + shadeLift;

  vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
  vWorldNormal = worldNormal;
  vSlopeAngle = 1.0 - abs(worldNormal.y);
  vHeight = shadePos.y;

  vec3 viewPos = modelViewMatrix[3].xyz + mat3(viewMatrix) * (worldPos - wrapOrigin);
  gl_Position = projectionMatrix * vec4(curveViewPos(viewPos), 1.0);
}
