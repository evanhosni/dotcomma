/**
 * Terrain chunk computation worker.
 *
 * Receives a chunk descriptor (the local vertex grid is a pure function of
 * chunkSize/segments, so it is generated HERE rather than built and
 * transferred by the main thread every build), computes heights + shader
 * attributes using the inlined vertex pipeline (noise, voronoi, biome
 * heights, city grid), plus the vertex normals and the Rapier column-major
 * collider heights — everything the main thread used to do per chunk except
 * the final buffer writes.
 *
 * Messages:
 *   IN:  { type: "INIT", config: DomainConfig }
 *   IN:  { type: "BUILD_CHUNK", id, segments, chunkSize, offsetX, offsetZ, skipPads, needCollider }
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "CHUNK_BUILT", id, heights, biomeIds, distBiome, distRegion, distRoad,
 *          distFreeway, freewayAlong, normals, colliderHeights? }
 */

import { DomainConfig, initCompute, computeVertexData, computeVertexDataRaw } from "./vertexCompute";

let initialized = false;

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

    const { id, segments, chunkSize, offsetX, offsetZ, skipPads, needCollider } = e.data;
    const n: number = segments + 1;
    const count = n * n;
    const half = chunkSize / 2;
    // Far visual-only LODs skip flatten pads (sub-vertex-spacing features;
    // computing their tiles exploded far city chunk builds).
    const compute = skipPads ? computeVertexDataRaw : computeVertexData;

    // Local plane-frame grid (same layout as the pooled geometry: PlaneGeometry
    // convention, y flipped vs world Z). fround matches the float32 positions
    // the main thread used to transfer, so heights stay bit-identical.
    const localX = new Float64Array(n);
    const localY = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      localX[i] = Math.fround((i / segments) * chunkSize - half);
      localY[i] = Math.fround(-(i / segments) * chunkSize + half);
    }

    const heights = new Float32Array(count);
    const biomeIds = new Float32Array(count);
    const distBiome = new Float32Array(count);
    const distRegion = new Float32Array(count);
    const distRoad = new Float32Array(count);
    const distFreeway = new Float32Array(count);
    const freewayAlong = new Float32Array(count);

    for (let iz = 0; iz < n; iz++) {
      const wz = -localY[iz] + offsetZ;
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const result = compute(localX[ix] + offsetX, wz);
        heights[i] = result.height;
        biomeIds[i] = result.biomeId;
        distBiome[i] = result.distanceToBiomeBoundaryCenter;
        distRegion[i] = result.distanceToRiverCenter;
        distRoad[i] = result.distanceToRoadCenter;
        distFreeway[i] = result.distanceToFreewayCenter;
        freewayAlong[i] = result.freewayAlong;
      }
    }

    // Vertex normals in the local plane frame (positions = (x, y, height)),
    // replicating THREE's computeVertexNormals exactly: per-triangle
    // cross(c-b, a-b) accumulated area-weighted, then normalized. Only the
    // main grid — skirt triangles never touch main-grid vertices, and skirt
    // normals are edge copies the main thread applies afterwards. This used
    // to run on the MAIN thread over the full index buffer (including 768
    // skirt triangles whose results were then overwritten).
    const normals = new Float32Array(count * 3);
    for (let iz = 0; iz < segments; iz++) {
      for (let ix = 0; ix < segments; ix++) {
        const a = iz * n + ix;
        const b = a + 1;
        const d = (iz + 1) * n + ix;
        const c = d + 1;
        // Two triangles per quad, same winding as the geometry's index
        // buffer: (a, d, b) and (d, c, b)
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

    // Rapier heightfield wants COLUMN-MAJOR heights (col = X axis = ix,
    // row = Z axis = iz) — emit it here so the main thread skips the
    // per-collider transpose loop + allocation.
    let colliderHeights: Float32Array | null = null;
    if (needCollider) {
      colliderHeights = new Float32Array(count);
      for (let iz = 0; iz < n; iz++) {
        for (let ix = 0; ix < n; ix++) {
          colliderHeights[ix * n + iz] = heights[iz * n + ix];
        }
      }
    }

    const transfer: Transferable[] = [
      heights.buffer,
      biomeIds.buffer,
      distBiome.buffer,
      distRegion.buffer,
      distRoad.buffer,
      distFreeway.buffer,
      freewayAlong.buffer,
      normals.buffer,
    ];
    if (colliderHeights) transfer.push(colliderHeights.buffer);
    (self as any).postMessage(
      {
        type: "CHUNK_BUILT",
        id,
        heights,
        biomeIds,
        distBiome,
        distRegion,
        distRoad,
        distFreeway,
        freewayAlong,
        normals,
        colliderHeights,
      },
      transfer
    );
  }
};
