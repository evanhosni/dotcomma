/**
 * A cave ENTRANCE is one surface: inside each mouth's footprint the mesher meshes "air above the
 * drawn ground OR in the tunnel" as one isosurface, so ground and walls share vertices. Every
 * footprint triangle is the PATCH, drawn by the terrain's own program: its ground vertices snapped
 * exactly onto the drawn ground with the terrain's normals, every vertex carrying the terrain's
 * per-vertex fields plus its rock share and daylight. Three-free.
 */

import { DRESSING_CHUNK_SIZE } from "../../../objects/dressing/types";
import { RIVER_BED_FAR } from "../../../world/shaders/constants";
import { smoothstep } from "../../math/_math";
import { terrainSnowDepth } from "../snow/snowDrift";
import { computeVertexData, getBiomeSlots } from "../vertexCompute";
import { PATCH_ROCK_FADE } from "./constants";
import { drawnGroundAt, drawnNormalAt } from "./drawnGround";
import { insideMouthFootprint, mouthFootprintBounds } from "./tunnelField";
import type { EntrancePatch, MouthPiece } from "./types";

/** Two vec4 attributes per field: world/terrain/material.ts MAX_BIOME_SLOTS (not imported: it holds Three). */
const MAX_BIOME_SLOTS = 8;

/** The mouths whose footprint reaches a square. */
export const mouthsReaching = (mouths: readonly MouthPiece[], minX: number, minZ: number, maxX: number, maxZ: number): MouthPiece[] =>
  mouths.filter((m) => {
    const b = mouthFootprintBounds(m);
    return b.minX <= maxX && b.maxX >= minX && b.minZ <= maxZ && b.maxZ >= minZ;
  });

/** Every dressing chunk ("minX,minZ") a mouth's footprint spans. */
export const footprintCells = (m: MouthPiece): string[] => {
  const b = mouthFootprintBounds(m);
  const cells: string[] = [];
  for (let cx = Math.floor(b.minX / DRESSING_CHUNK_SIZE); cx <= Math.floor(b.maxX / DRESSING_CHUNK_SIZE); cx++) {
    for (let cz = Math.floor(b.minZ / DRESSING_CHUNK_SIZE); cz <= Math.floor(b.maxZ / DRESSING_CHUNK_SIZE); cz++) {
      cells.push(`${cx * DRESSING_CHUNK_SIZE},${cz * DRESSING_CHUNK_SIZE}`);
    }
  }
  return cells;
};

export const inAnyFootprint = (mouths: readonly MouthPiece[], x: number, z: number): boolean => {
  for (const m of mouths) if (insideMouthFootprint(m, x, z)) return true;
  return false;
};


/** The rock share of a vertex `depth` under the ground: 0 on the ground, 1 by PATCH_ROCK_FADE under it. */
const rockShareAt = (depth: number): number => smoothstep(0, PATCH_ROCK_FADE, depth);

/** The patch's buffers: one entry per patch vertex, in the order `vertices` lists them. */
export interface PatchVertex {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  ground: boolean;
  daylight: number;
}

/** Builds the entrance patch for `vertices` (positions absolute; written relative to the chunk's
 *  center), with the terrain's per-vertex fields evaluated at each one. */
export const buildPatch = (vertices: readonly PatchVertex[], indices: number[], centerX: number, centerZ: number): EntrancePatch => {
  const n = vertices.length;
  const slots = getBiomeSlots().length;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const biomeSdf0 = new Float32Array(n * 4);
  const biomeSdf1 = new Float32Array(n * 4);
  const biomePresence0 = new Float32Array(n * 4);
  const biomePresence1 = new Float32Array(n * 4);
  const riverbedSdf0 = new Float32Array(n * 4);
  const riverbedSdf1 = new Float32Array(n * 4);
  const riverBedDistance = new Float32Array(n);
  const distanceToRoadCenter = new Float32Array(n);
  const distanceToFreewayCenter = new Float32Array(n);
  const freewayAlong = new Float32Array(n);
  const underwaterDepth = new Float32Array(n);
  const entranceRock = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    const ground = drawnGroundAt(v.x, v.z);
    let y = v.y;
    let nx = v.nx;
    let ny = v.ny;
    let nz = v.nz;
    if (v.ground) {
      y = ground;
      const dn = drawnNormalAt(v.x, v.z);
      nx = dn.x;
      ny = dn.y;
      nz = dn.z;
    }
    positions[i * 3] = v.x - centerX;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = v.z - centerZ;
    normals[i * 3] = nx;
    normals[i * 3 + 1] = ny;
    normals[i * 3 + 2] = nz;
    const vd = computeVertexData(v.x, v.z);
    for (let s = 0; s < MAX_BIOME_SLOTS; s++) {
      const sdf = s < slots ? vd.biomeSdf[s] : -1e4;
      const pres = s < slots ? vd.biomePresence[s] : -1e4;
      const bed = s < slots ? vd.riverbedSdf[s] : -1e4;
      if (s < 4) {
        biomeSdf0[i * 4 + s] = sdf;
        biomePresence0[i * 4 + s] = pres;
        riverbedSdf0[i * 4 + s] = bed;
      } else {
        biomeSdf1[i * 4 + s - 4] = sdf;
        biomePresence1[i * 4 + s - 4] = pres;
        riverbedSdf1[i * 4 + s - 4] = bed;
      }
    }
    riverBedDistance[i] = Math.min(vd.riverBedDistance, RIVER_BED_FAR);
    distanceToRoadCenter[i] = vd.distanceToRoadCenter;
    distanceToFreewayCenter[i] = vd.distanceToFreewayCenter;
    freewayAlong[i] = vd.freewayAlong;
    const water = vd.waterHeight > vd.height ? vd.waterHeight - vd.height : 0;
    const slope = (Math.acos(Math.min(1, Math.max(-1, ny))) * 180) / Math.PI;
    underwaterDepth[i] = water > 0 ? water : -terrainSnowDepth(v.x, v.z, vd, slope);
    entranceRock[i * 2] = rockShareAt(ground - y);
    entranceRock[i * 2 + 1] = v.daylight;
  }
  return {
    positions,
    normals,
    indices: new Uint32Array(indices),
    biomeSdf0,
    biomeSdf1,
    biomePresence0,
    biomePresence1,
    riverbedSdf0,
    riverbedSdf1,
    riverBedDistance,
    distanceToRoadCenter,
    distanceToFreewayCenter,
    freewayAlong,
    underwaterDepth,
    entranceRock,
  };
};
