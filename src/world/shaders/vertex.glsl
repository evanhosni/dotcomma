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
// Water depth ≥ 0 over the ground, else −(the terrain's own snow depth): the program has no attribute
// slot left (snow never lies under water).
attribute float underwaterDepth;
varying float vUnderwaterDepth;
varying float vFarSnow;
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
varying float vSkirt;
#ifdef ENTRANCE_PATCH
// The entrance patch's rock share and daylight (the cave's one isosurface of ground and tunnel).
attribute vec2 entranceRock;
varying vec2 vEntranceRock;
#endif

// projectChunkLocal() (world/shaders/chunkProjection.ts — the wrapped origin, quantization, the
// CPU-resolved view-space origin, curvature; it writes vWorldPosWrapped/vWorldPosAbs/vWorldNormal/
// vFarDistance) and the WORLD_WRAP define are prepended by world/terrain/material.ts.
//
// BIOME BLEND: vBiomeSdf* carry a SIGNED DISTANCE per biome slot (scaled so ±1 is
// the feather edge) and vBiomePresence* the signed distance to the biome's OWN
// boundary in its blend widths — never a weight or an id. Signed distance
// interpolates linearly, so the fragment shader's smoothsteps land a 1–3u feather
// at pixel resolution even on 17.5u quads (a per-triangle `flat` biome id would
// draw staircase edges and stray outlines at every wall).

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
  vUnderwaterDepth = max(underwaterDepth, 0.0);
  vFarSnow = max(-underwaterDepth, 0.0);
  vUv = uv;
  vSkirt = skirtDrop;
  #ifdef ENTRANCE_PATCH
  vEntranceRock = entranceRock;
  #endif

  gl_Position = projectChunkLocal(position, normal);
  vWorldUv = vWorldPosWrapped.xz / TEXTURE_TILE;
  vSlopeAngle = 1.0 - abs(vWorldNormal.y);
  vHeight = vWorldPosWrapped.y;
}
