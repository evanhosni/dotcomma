import * as THREE from "three";
import { BIOME_SDF_FAR } from "../../utils/workers/vertexCompute";
import { LODLevel } from "./lodConfig";
import { MAX_BIOME_SLOTS } from "./material";
import type { ChunkBuildResult } from "./terrainWorker";

// A chunk's mesh buffers: a (segments + 1)² grid in PlaneGeometry's layout (rotated to y-up by the
// plane) plus a SKIRT ring hanging below the perimeter, pooled per LOD and refilled from each worker
// result. Skirt vertices copy their edge vertex's attributes and normals.

/** Clockwise loop of main-grid edge vertex indices (4 × segments). */
const perimeterCache = new Map<number, number[]>();
const getPerimeterIndices = (segments: number): number[] => {
  let cached = perimeterCache.get(segments);
  if (cached) return cached;
  const n = segments + 1;
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) indices.push(i);
  for (let i = 0; i < segments; i++) indices.push(i * n + segments);
  for (let i = segments; i > 0; i--) indices.push(segments * n + i);
  for (let i = segments; i > 0; i--) indices.push(i * n);
  perimeterCache.set(segments, indices);
  return indices;
};

/** Grid + a skirt ring around the perimeter (skirt heights are filled per build). */
const createChunkGeometry = (chunkSize: number, segments: number, skirtDepth: number): THREE.BufferGeometry => {
  const n = segments + 1;
  const mainVertCount = n * n;
  const perimeterIndices = getPerimeterIndices(segments);
  const perimCount = perimeterIndices.length;
  const totalVerts = mainVertCount + perimCount * 2;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  const halfSize = chunkSize / 2;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const idx = iz * n + ix;
      const x = (ix / segments) * chunkSize - halfSize;
      const y = -(iz / segments) * chunkSize + halfSize; // PlaneGeometry Y convention (flipped Z)
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = 0;
      normals[idx * 3 + 2] = 1; // face +Z (will be rotated to +Y)
      uvs[idx * 2] = ix / segments;
      uvs[idx * 2 + 1] = 1 - iz / segments;
    }
  }

  const mainIndexCount = segments * segments * 6;
  const skirtIndexCount = perimCount * 6;
  const indexArray = new Uint32Array(mainIndexCount + skirtIndexCount);
  let ii = 0;
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * n + ix;
      const b = iz * n + ix + 1;
      const c = (iz + 1) * n + ix + 1;
      const d = (iz + 1) * n + ix;
      indexArray[ii++] = a;
      indexArray[ii++] = d;
      indexArray[ii++] = b;
      indexArray[ii++] = d;
      indexArray[ii++] = c;
      indexArray[ii++] = b;
    }
  }

  const skirtTopStart = mainVertCount;
  const skirtBotStart = mainVertCount + perimCount;
  for (let i = 0; i < perimCount; i++) {
    const srcIdx = perimeterIndices[i];
    positions[(skirtTopStart + i) * 3] = positions[srcIdx * 3];
    positions[(skirtTopStart + i) * 3 + 1] = positions[srcIdx * 3 + 1];
    positions[(skirtTopStart + i) * 3 + 2] = 0;
    positions[(skirtBotStart + i) * 3] = positions[srcIdx * 3];
    positions[(skirtBotStart + i) * 3 + 1] = positions[srcIdx * 3 + 1];
    positions[(skirtBotStart + i) * 3 + 2] = -skirtDepth;
    normals[(skirtTopStart + i) * 3 + 2] = 1;
    normals[(skirtBotStart + i) * 3 + 2] = 1;
    uvs[(skirtTopStart + i) * 2] = uvs[srcIdx * 2];
    uvs[(skirtTopStart + i) * 2 + 1] = uvs[srcIdx * 2 + 1];
    uvs[(skirtBotStart + i) * 2] = uvs[srcIdx * 2];
    uvs[(skirtBotStart + i) * 2 + 1] = uvs[srcIdx * 2 + 1];
  }

  for (let i = 0; i < perimCount; i++) {
    const next = (i + 1) % perimCount;
    const t0 = skirtTopStart + i;
    const t1 = skirtTopStart + next;
    const b0 = skirtBotStart + i;
    const b1 = skirtBotStart + next;
    indexArray[ii++] = t0;
    indexArray[ii++] = t1;
    indexArray[ii++] = b0;
    indexArray[ii++] = b0;
    indexArray[ii++] = t1;
    indexArray[ii++] = b1;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(indexArray, 1));
  return geom;
};

const geometryPool: Map<number, THREE.BufferGeometry[]> = new Map();

/** A chunk grid of this LOD's size, from the pool when one is free. Terrain and water share the family. */
export const acquireGeometry = (lod: LODLevel): THREE.BufferGeometry => {
  const pool = geometryPool.get(lod.level);
  if (pool && pool.length > 0) {
    return pool.pop()!;
  }
  return createChunkGeometry(lod.chunkSize, lod.segments, lod.skirtDepth);
};

export const releaseGeometry = (lod: LODLevel, geom: THREE.BufferGeometry) => {
  // three caches the lazily computed bounds for the geometry's life — a pooled
  // geometry otherwise keeps its FIRST chunk's sphere (edge-of-screen popping).
  geom.boundingSphere = null;
  geom.boundingBox = null;
  let pool = geometryPool.get(lod.level);
  if (!pool) {
    pool = [];
    geometryPool.set(lod.level, pool);
  }
  pool.push(geom);
};

/** The geometry's `name` attribute array, (re)created when a pooled geometry lacks it. */
const ensureAttribute = (geom: THREE.BufferGeometry, name: string, itemSize = 1): Float32Array => {
  const vertexCount = geom.attributes.position.count;
  const existing = geom.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (existing && existing.count === vertexCount && existing.itemSize === itemSize) return existing.array as Float32Array;
  const arr = new Float32Array(vertexCount * itemSize);
  geom.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  return arr;
};

/** Both skirt rings take their edge vertex's value. */
const copyEdgeToSkirt = (array: Float32Array, itemSize: number, perimeterIndices: number[], mainVertCount: number): void => {
  const perimCount = perimeterIndices.length;
  for (let i = 0; i < perimCount; i++) {
    const src = perimeterIndices[i] * itemSize;
    const top = (mainVertCount + i) * itemSize;
    const bot = (mainVertCount + perimCount + i) * itemSize;
    for (let c = 0; c < itemSize; c++) {
      array[top + c] = array[src + c];
      array[bot + c] = array[src + c];
    }
  }
};

/** The per-vertex fields the terrain shader reads besides the blend slots (scalar, one per vertex). */
const SCALAR_FIELDS = [
  ["riverBedDistance", "riverBed"],
  ["distanceToRoadCenter", "distRoad"],
  ["distanceToFreewayCenter", "distFreeway"],
  ["freewayAlong", "freewayAlong"],
] as const;

/** Biome slots ride in two vec4 attributes each for sdf and presence (≤ MAX_BIOME_SLOTS, material.ts asserts). */
const writeBiomeSlots = (geom: THREE.BufferGeometry, lod: LODLevel, result: ChunkBuildResult, mainVertCount: number): void => {
  const { biomeSdf, biomePresence, slots } = result;
  const sdf0 = ensureAttribute(geom, "biomeSdf0", 4);
  const sdf1 = ensureAttribute(geom, "biomeSdf1", 4);
  const pres0 = ensureAttribute(geom, "biomePresence0", 4);
  const pres1 = ensureAttribute(geom, "biomePresence1", 4);
  const clampBlend = lod.clampBlendFields;
  for (let i = 0; i < mainVertCount; i++) {
    for (let s = 0; s < MAX_BIOME_SLOTS; s++) {
      let v = s < slots ? biomeSdf[i * slots + s] : -BIOME_SDF_FAR;
      let p = s < slots ? biomePresence[i * slots + s] : -BIOME_SDF_FAR;
      if (clampBlend) {
        v = v < -1 ? -1 : v > 1 ? 1 : v;
        p = p < 0 ? 0 : p > 1 ? 1 : p;
      }
      if (s < 4) {
        sdf0[i * 4 + s] = v;
        pres0[i * 4 + s] = p;
      } else {
        sdf1[i * 4 + (s - 4)] = v;
        pres1[i * 4 + (s - 4)] = p;
      }
    }
  }
  const perimeterIndices = getPerimeterIndices(lod.segments);
  for (const arr of [sdf0, sdf1, pres0, pres1]) copyEdgeToSkirt(arr, 4, perimeterIndices, mainVertCount);
};

/** Fills a terrain chunk's geometry from its worker result: heights (the skirt hangs `skirtDepth`
 *  below its edge), the biome blend slots, the road/river fields and the normals. */
export const writeTerrainBuffers = (geom: THREE.BufferGeometry, lod: LODLevel, result: ChunkBuildResult): void => {
  const n = lod.segments + 1;
  const mainVertCount = n * n;
  const perimeterIndices = getPerimeterIndices(lod.segments);
  const perimCount = perimeterIndices.length;

  const positions = geom.attributes.position.array as Float32Array;
  for (let i = 0; i < mainVertCount; i++) positions[i * 3 + 2] = result.heights[i];
  for (let i = 0; i < perimCount; i++) {
    const src3 = perimeterIndices[i] * 3;
    const top3 = (mainVertCount + i) * 3;
    const bot3 = (mainVertCount + perimCount + i) * 3;
    positions[top3] = positions[bot3] = positions[src3];
    positions[top3 + 1] = positions[bot3 + 1] = positions[src3 + 1];
    positions[top3 + 2] = positions[src3 + 2];
    positions[bot3 + 2] = positions[src3 + 2] - lod.skirtDepth;
  }

  writeBiomeSlots(geom, lod, result, mainVertCount);
  for (const [attribute, field] of SCALAR_FIELDS) {
    const arr = ensureAttribute(geom, attribute);
    const values = result[field];
    for (let i = 0; i < mainVertCount; i++) arr[i] = values[i];
    copyEdgeToSkirt(arr, 1, perimeterIndices, mainVertCount);
  }

  // Skirt normals copy the edge so the skirt never triggers the triplanar branch.
  const normals = geom.attributes.normal.array as Float32Array;
  normals.set(result.normals, 0);
  copyEdgeToSkirt(normals, 3, perimeterIndices, mainVertCount);

  for (const name of ["biomeSdf0", "biomeSdf1", "biomePresence0", "biomePresence1", ...SCALAR_FIELDS.map(([a]) => a)]) {
    (geom.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }
  geom.attributes.position.needsUpdate = true;
  geom.attributes.normal.needsUpdate = true;
};

/** Fills a chunk's WATER geometry over the same grid: wet vertices at the water height with their
 *  `waterDepth`, dry ones dived under the ground by at least the vertex spacing — a river is narrower
 *  than a coarse LOD's quads, and a shallower dive let one wet vertex's surface cover the triangles
 *  around it (a sheet over the banks). Along an edge the sheet ends within ~depth of the wet vertex. */
export const writeWaterBuffers = (
  water: THREE.BufferGeometry,
  terrain: THREE.BufferGeometry,
  lod: LODLevel,
  heights: Float32Array,
  waterHeights: Float32Array,
): void => {
  const n = lod.segments + 1;
  const mainVertCount = n * n;
  const perimeterIndices = getPerimeterIndices(lod.segments);
  const dryDive = Math.max(3, lod.chunkSize / lod.segments);
  const terrainPositions = terrain.attributes.position.array as Float32Array;
  const positions = water.attributes.position.array as Float32Array;
  const depths = ensureAttribute(water, "waterDepth");
  for (let i = 0; i < mainVertCount; i++) {
    const wh = waterHeights[i];
    const dry = Number.isNaN(wh) || wh <= heights[i];
    positions[i * 3] = terrainPositions[i * 3];
    positions[i * 3 + 1] = terrainPositions[i * 3 + 1];
    positions[i * 3 + 2] = dry ? heights[i] - dryDive : wh;
    depths[i] = dry ? 0 : wh - heights[i];
  }
  copyEdgeToSkirt(positions, 3, perimeterIndices, mainVertCount);
  const perimCount = perimeterIndices.length;
  for (let i = 0; i < perimCount * 2; i++) depths[mainVertCount + i] = 0;
  water.attributes.position.needsUpdate = true;
  (water.getAttribute("waterDepth") as THREE.BufferAttribute).needsUpdate = true;
  water.computeBoundingSphere();
};
