/**
 * The ENTRANCE PATCH's buffers: every nets triangle inside a mouth's footprint, ground and walls as one
 * surface, drawn by the terrain's own program (its ENTRANCE variant). So each vertex carries what the
 * terrain worker gives a terrain vertex — the biome slots, the riverbed, the roads, and the water depth
 * or MINUS the snow depth in one attribute (world/terrain/chunkGeometry.ts) — plus `entranceRock`: the
 * rock share (0 on the drawn ground, 1 by PATCH_ROCK_FADE under it) and the daylight. Three-free.
 */

import { smoothstep } from "../../math";
import { RIVER_BED_FAR } from "../../../world/shaders/constants";
import { snowBiomeIds } from "../snow/params";
import { snowCoverOf, terrainSnowDepthFrom } from "../snow/snowDrift";
import { BIOME_SDF_FAR } from "../zoneBlend";
import { computeVertexData, getBiomeSlots } from "../vertexCompute";
import { PATCH_ROCK_FADE } from "./constants";
import { drawnGroundAt, drawnNormalAt } from "./drawnGround";
import type { EntrancePatch } from "./types";

/** The terrain program's biome slots: two vec4 attributes each (world/terrain/material.ts MAX_BIOME_SLOTS). */
const SLOTS = 8;

/** A patch vertex: absolute position, its normal (the drawn ground's on the ground), its daylight. */
export interface PatchVertex {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  light: number;
}

/** The patch from its vertices and triangles; positions relative to (centerX, 0, centerZ) like the walls. */
export const buildPatch = (vertices: readonly PatchVertex[], indices: readonly number[], centerX: number, centerZ: number): EntrancePatch => {
  const n = vertices.length;
  const slots = getBiomeSlots().length;
  const snow = snowBiomeIds().length > 0;
  const patch: EntrancePatch = {
    positions: new Float32Array(n * 3),
    normals: new Float32Array(n * 3),
    indices: new Uint32Array(indices),
    biomeSdf0: new Float32Array(n * 4),
    biomeSdf1: new Float32Array(n * 4),
    biomePresence0: new Float32Array(n * 4),
    biomePresence1: new Float32Array(n * 4),
    riverbedSdf0: new Float32Array(n * 4),
    riverbedSdf1: new Float32Array(n * 4),
    riverBedDistance: new Float32Array(n),
    distanceToRoadCenter: new Float32Array(n),
    distanceToFreewayCenter: new Float32Array(n),
    freewayAlong: new Float32Array(n),
    underwaterDepth: new Float32Array(n),
    entranceRock: new Float32Array(n * 2),
  };
  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    patch.positions[i * 3] = v.x - centerX;
    patch.positions[i * 3 + 1] = v.y;
    patch.positions[i * 3 + 2] = v.z - centerZ;
    patch.normals[i * 3] = v.nx;
    patch.normals[i * 3 + 1] = v.ny;
    patch.normals[i * 3 + 2] = v.nz;
    patch.entranceRock[i * 2] = smoothstep(0, PATCH_ROCK_FADE, drawnGroundAt(v.x, v.z) - v.y);
    patch.entranceRock[i * 2 + 1] = v.light;
    // The scratch buffers of this result are overwritten by the next call (and by the snow's reads):
    // everything is copied out first.
    const vd = computeVertexData(v.x, v.z);
    for (let s = 0; s < SLOTS; s++) {
      const sdf = s < slots ? vd.biomeSdf[s] : -BIOME_SDF_FAR;
      const presence = s < slots ? vd.biomePresence[s] : -BIOME_SDF_FAR;
      const bed = s < slots ? vd.riverbedSdf[s] : -BIOME_SDF_FAR;
      const o = i * 4 + (s & 3);
      if (s < 4) {
        patch.biomeSdf0[o] = sdf;
        patch.biomePresence0[o] = presence;
        patch.riverbedSdf0[o] = bed;
      } else {
        patch.biomeSdf1[o] = sdf;
        patch.biomePresence1[o] = presence;
        patch.riverbedSdf1[o] = bed;
      }
    }
    patch.riverBedDistance[i] = Math.min(vd.riverBedDistance, RIVER_BED_FAR);
    patch.distanceToRoadCenter[i] = vd.distanceToRoadCenter;
    patch.distanceToFreewayCenter[i] = vd.distanceToFreewayCenter;
    patch.freewayAlong[i] = vd.freewayAlong;
    const waterDepth = vd.waterDepth;
    const height = vd.height;
    const cover = snow ? snowCoverOf(vd) : 0;
    if (waterDepth > 0) patch.underwaterDepth[i] = waterDepth;
    else if (cover > 0) {
      const ny = drawnNormalAt(v.x, v.z).y;
      patch.underwaterDepth[i] = -terrainSnowDepthFrom(v.x, v.z, height, cover, (Math.acos(Math.min(1, ny)) * 180) / Math.PI);
    }
  }
  return patch;
};
