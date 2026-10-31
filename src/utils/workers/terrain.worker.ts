/**
 * Terrain chunk worker: heights + shader attributes (the shared vertex pipeline),
 * vertex normals, the water surface, the snow depths and the Rapier column-major collider heights —
 * the main thread only writes buffers.
 *
 *   IN:  { type: "INIT", config: DomainConfig }
 *   IN:  { type: "BUILD_CHUNK", id, segments, chunkSize, offsetX, offsetZ, visualOnly, carvesRivers, cutsDecks, needCollider }
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "CHUNK_BUILT", id, heights, biomeSdf, biomePresence (count × slots, interleaved),
 *          slots, riverBed, distRoad, distFreeway, freewayAlong, normals,
 *          waterHeights (NaN = none) + waterDepths + waterFlow (x/z pairs) | null when the chunk has no water, snowDepths | null, colliderHeights? }
 */

import { DomainConfig, initCompute, computeVertexData, computeVertexDataFar, getBiomeSlots, setDeckCutSpacing } from "./vertexCompute";
import { RIVER_BED_FAR } from "../../world/shaders/constants";
import { snowCoverOf, terrainSnowDepthFrom } from "./snow/snowDrift";
import { snowBiomeIds } from "./snow/params";

let initialized = false;

/** THREE.computeVertexNormals replicated exactly, main grid only (skirt normals are edge copies the
 *  main thread applies afterwards). `localX`/`localY` are the PlaneGeometry's local frame. */
const gridNormals = (localX: Float64Array, localY: Float64Array, heights: Float32Array, segments: number): Float32Array => {
  const n = segments + 1;
  const count = n * n;
  const normals = new Float32Array(count * 3);
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const d = (iz + 1) * n + ix;
      const c = d + 1;
      // Same winding as the index buffer: (a, d, b) and (d, c, b)
      for (let t = 0; t < 2; t++) {
        const iA = t === 0 ? a : d;
        const iB = t === 0 ? d : c;
        const iC = b;
        const ax = localX[iA % n], ay = localY[(iA / n) | 0], az = heights[iA];
        const bx = localX[iB % n], by = localY[(iB / n) | 0], bz = heights[iB];
        const cx = localX[iC % n], cy = localY[(iC / n) | 0], cz = heights[iC];
        const cbx = cx - bx, cby = cy - by, cbz = cz - bz;
        const abx = ax - bx, aby = ay - by, abz = az - bz;
        const nx = cby * abz - cbz * aby;
        const ny = cbz * abx - cbx * abz;
        const nz = cbx * aby - cby * abx;
        normals[iA * 3] += nx; normals[iA * 3 + 1] += ny; normals[iA * 3 + 2] += nz;
        normals[iB * 3] += nx; normals[iB * 3 + 1] += ny; normals[iB * 3 + 2] += nz;
        normals[iC * 3] += nx; normals[iC * 3 + 1] += ny; normals[iC * 3 + 2] += nz;
      }
    }
  }
  for (let i = 0; i < count; i++) {
    const x = normals[i * 3], y = normals[i * 3 + 1], z = normals[i * 3 + 2];
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 0) {
      normals[i * 3] = x / len;
      normals[i * 3 + 1] = y / len;
      normals[i * 3 + 2] = z / len;
    }
  }
  return normals;
};

/** Rapier wants COLUMN-MAJOR heights (col = X = ix, row = Z = iz). */
const columnMajorHeights = (heights: Float32Array, n: number): Float32Array => {
  const out = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      out[ix * n + iz] = heights[iz * n + ix];
    }
  }
  return out;
};

/** The snow depth per vertex from its height, cover and the slope of its own grid (central differences). */
const gridSnowDepths = (localX: Float64Array, offsetX: number, offsetZ: number, heights: Float32Array, cover: Float32Array, segments: number, spacing: number): Float32Array => {
  const n = segments + 1;
  const out = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    const z0 = Math.max(0, iz - 1);
    const z1 = Math.min(n - 1, iz + 1);
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      if (cover[i] <= 0) continue;
      const x0 = Math.max(0, ix - 1);
      const x1 = Math.min(n - 1, ix + 1);
      const dhdx = (heights[iz * n + x1] - heights[iz * n + x0]) / ((x1 - x0) * spacing);
      const dhdz = (heights[z1 * n + ix] - heights[z0 * n + ix]) / ((z1 - z0) * spacing);
      const slope = (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI;
      out[i] = terrainSnowDepthFrom(localX[ix] + offsetX, iz * spacing - (spacing * segments) / 2 + offsetZ, heights[i], cover[i], slope);
    }
  }
  return out;
};

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  if (type === "INIT") {
    initCompute(e.data.config as DomainConfig);
    initialized = true;
    (self as any).postMessage({ type: "INIT_DONE" });
    return;
  }

  if (type === "BUILD_CHUNK") {
    if (!initialized) {
      (self as any).postMessage({ type: "ERROR", error: "Worker not initialized" });
      return;
    }

    const { id, segments, chunkSize, offsetX, offsetZ, visualOnly, carvesRivers, cutsDecks, needCollider } = e.data;
    const n: number = segments + 1;
    const count = n * n;
    const half = chunkSize / 2;
    // Far visual-only LODs skip flatten pads and the freeway runs, the farthest the river field too
    // (computeVertexDataFar, LODLevel.carvesRivers, CLAUDE.md). A collider LOD always carves, and cuts
    // the ground under decks unless its LOD says not to (LODLevel.cutsDecks).
    const cut = cutsDecks !== false;
    const compute = visualOnly
      ? (x: number, z: number) => computeVertexDataFar(x, z, carvesRivers !== false)
      : (x: number, z: number) => computeVertexData(x, z, cut);
    const slots = getBiomeSlots().length;
    // The ground under decks is cut as far beside them as this chunk's triangles reach.
    setDeckCutSpacing(chunkSize / segments);
    // Every LOD carries its snow: the terrain whitens at every LOD (world/terrain/README.md).
    const snow = snowBiomeIds().length > 0;

    // PlaneGeometry local frame (y flipped vs world Z); fround keeps heights
    // bit-identical to the float32 positions.
    const localX = new Float64Array(n);
    const localY = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      localX[i] = Math.fround((i / segments) * chunkSize - half);
      localY[i] = Math.fround(-(i / segments) * chunkSize + half);
    }

    const heights = new Float32Array(count);
    const biomeSdf = new Float32Array(count * slots);
    const biomePresence = new Float32Array(count * slots);
    const riverbedSdf = new Float32Array(count * slots);
    const riverBed = new Float32Array(count);
    const distRoad = new Float32Array(count);
    const distFreeway = new Float32Array(count);
    const freewayAlong = new Float32Array(count);
    const waterHeights = new Float32Array(count);
    const waterDepths = new Float32Array(count);
    const waterFlow = new Float32Array(count * 2);
    const snowCover = snow ? new Float32Array(count) : null;
    let hasWater = false;

    for (let iz = 0; iz < n; iz++) {
      const wz = -localY[iz] + offsetZ;
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const result = compute(localX[ix] + offsetX, wz);
        heights[i] = result.height;
        for (let s = 0; s < slots; s++) {
          biomeSdf[i * slots + s] = result.biomeSdf[s];
          biomePresence[i * slots + s] = result.biomePresence[s];
          riverbedSdf[i * slots + s] = result.riverbedSdf[s];
        }
        riverBed[i] = Math.min(result.riverBedDistance, RIVER_BED_FAR);
        distRoad[i] = result.distanceToRoadCenter;
        distFreeway[i] = result.distanceToFreewayCenter;
        freewayAlong[i] = result.freewayAlong;
        waterHeights[i] = result.waterHeight;
        waterDepths[i] = result.waterDepth;
        waterFlow[i * 2] = result.waterFlowX;
        waterFlow[i * 2 + 1] = result.waterFlowZ;
        if (result.waterDepth > 0) hasWater = true;
        if (snowCover) snowCover[i] = snowCoverOf(result);
      }
    }

    const normals = gridNormals(localX, localY, heights, segments);
    const colliderHeights = needCollider ? columnMajorHeights(heights, n) : null;
    const snowDepths = snowCover ? gridSnowDepths(localX, offsetX, offsetZ, heights, snowCover, segments, chunkSize / segments) : null;

    const transfer: Transferable[] = [
      heights.buffer,
      biomeSdf.buffer,
      biomePresence.buffer,
      riverbedSdf.buffer,
      riverBed.buffer,
      distRoad.buffer,
      distFreeway.buffer,
      freewayAlong.buffer,
      normals.buffer,
    ];
    if (hasWater) transfer.push(waterHeights.buffer, waterDepths.buffer, waterFlow.buffer);
    if (colliderHeights) transfer.push(colliderHeights.buffer);
    if (snowDepths) transfer.push(snowDepths.buffer);
    (self as any).postMessage(
      {
        type: "CHUNK_BUILT",
        id,
        heights,
        biomeSdf,
        biomePresence,
        riverbedSdf,
        slots,
        riverBed,
        distRoad,
        distFreeway,
        freewayAlong,
        normals,
        waterHeights: hasWater ? waterHeights : null,
        waterDepths: hasWater ? waterDepths : null,
        waterFlow: hasWater ? waterFlow : null,
        snowDepths,
        colliderHeights,
      },
      transfer
    );
  }
};
