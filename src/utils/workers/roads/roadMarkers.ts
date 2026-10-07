/**
 * RAISED PAVEMENT MARKERS (CLAUDE.md "City terrain"): studs along the city's street and freeway
 * centerlines and on the inter-city runs' medians. Duplicate-free under chunked queries (ownership by
 * world position), validated through computeVertexData (tests: cityFeatures.test.ts).
 */

import { CITY_BIOME_ID } from "../../../world/constants";
import { domainConfig } from "../computeConfig";
import { unwarp, warp } from "../noise";
import { riverKeepOff } from "../rivers/constants";
import { computeVertexData } from "../vertexCompute";
import { isCanonicalWall } from "../voronoi";
import { CITY_RING_RADIUS_FRAC, CITY_SHAPE_CIRCLE, CITY_SHAPE_TRI_NE, CITY_SHAPE_TRI_NW, type CityCell } from "./cityCells";
import { cityCellAtLocal, cityChunkLocalAABB, cityWallsAround, chunkRowRange, chunkSegRange } from "./cityChunks";
import {
  CITY_WIGGLE_AMP,
  cityArterialDist,
  cityDistrictByIndex,
  cityDistrictPitch,
  cityLocalToWorld,
  cityRowBoundary,
  cityRowEdgeZ,
  citySegBoundary,
  citySegEdgeX,
  cityWiggleSlope,
  findCitySeg,
  getCityDistrict,
  rowWiggle,
  segWiggle,
} from "./cityDistricts";
import { NO_ROAD_DISTANCE } from "./cityRoadField";
import { freewayPointAt, getNetwork } from "./freewayNetwork";

export interface RoadMarkerPoint {
  x: number;
  y: number; // terrain height at the marker (curb dip included)
  z: number;
  dirX: number; // unit direction of the road at this marker
  dirZ: number;
}

type EmitMarker = (mx: number, mz: number, dirX: number, dirZ: number) => void;

/** Ownership by world position (deterministic per district / global lattices
 *  for arterials) keeps chunked calls duplicate-free. */
export function getCityRoadMarkers(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  streetSpacing: number,
  freewaySpacing: number
): RoadMarkerPoint[] {
  if (!domainConfig || !domainConfig.cityConfig) return [];
  const city = domainConfig.cityConfig;
  const out: RoadMarkerPoint[] = [];

  const emitIfOnRoadCenter: EmitMarker = (mx, mz, dirX, dirZ) => {
    const vd = computeVertexData(mx, mz);
    if (vd.biomeId !== CITY_BIOME_ID) return; // city biome only
    if (vd.distanceToRiverCenter < riverKeepOff() || vd.underDeck > 0) return;
    if (vd.distanceToRoadCenter > 2) return; // melted/chamfered zones drop out
    // Strictly INSIDE the belt ring, one-sided (an abs-window corridor check would leak markers into
    // the strip between the belt and the biome boundary).
    if (vd.distanceToBiomeBoundaryCenter < city.freewayWidth + 5) return;
    out.push({ x: mx, y: vd.height, z: mz, dirX, dirZ });
  };

  // A freeway's median studs follow its lane paint: where a freeway ends at a river with no deck,
  // both stop short of it (computeVertexData step 7b), so it does not read as running on.
  const emitIfOnPaintedFreeway: EmitMarker = (mx, mz, dirX, dirZ) => {
    if (computeVertexData(mx, mz).distanceToFreewayCenter >= NO_ROAD_DISTANCE) return;
    emitIfOnRoadCenter(mx, mz, dirX, dirZ);
  };
  emitStreetMarkers(minX, minZ, maxX, maxZ, streetSpacing, emitIfOnRoadCenter);
  emitArterialMarkers(minX, minZ, maxX, maxZ, freewaySpacing, emitIfOnPaintedFreeway);
  emitBeltMarkers(minX, minZ, maxX, maxZ, freewaySpacing, out);
  return out;
}

/** Street centerlines, per district: enumerated in the LOCAL frame, rotated out, owned by world
 *  position, clipped to the wiggly district. */
const emitStreetMarkers = (minX: number, minZ: number, maxX: number, maxZ: number, streetSpacing: number, emit: EmitMarker): void => {
  const city = domainConfig!.cityConfig;
  const gs = city.gridSize;
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const [rows0, rows1] = chunkRowRange(minZ, maxZ, midX);
  for (let r = rows0; r <= rows1; r++) {
    const [m0, m1] = chunkSegRange(r, minX, maxX, midZ);
    for (let m = m0; m <= m1; m++) {
      const d = cityDistrictByIndex(r, m);

      const cellAt = (ix: number, iz: number): CityCell => cityCellAtLocal(ix, iz, d);

      const emitLocalMarker = (lmx: number, lmz: number, ldx: number, ldz: number) => {
        const p = cityLocalToWorld(lmx, lmz, d);
        if (p.x < minX || p.x >= maxX || p.z < minZ || p.z >= maxZ) return; // chunk ownership
        if (getCityDistrict(p.x, p.z).key !== d.key) return; // district clip (wiggly edges)
        if (cityArterialDist(p.x, p.z, d) < city.freewayWidth + 5) return; // stop at arterials
        emit(p.x, p.z, ldx * d.cos - ldz * d.sin, ldx * d.sin + ldz * d.cos);
      };

      // A boundary marker sits on a cell edge — test the cell and its west/south neighbors too.
      const insideRoundabout = (lmx: number, lmz: number): boolean => {
        const cx = Math.floor(lmx / gs);
        const cz = Math.floor(lmz / gs);
        for (const [ix, iz] of [
          [cx, cz],
          [cx - 1, cz],
          [cx, cz - 1],
        ]) {
          if (cellAt(ix, iz).shape !== CITY_SHAPE_CIRCLE) continue;
          const sx = Math.floor(ix / 2);
          const sz = Math.floor(iz / 2);
          const rr = Math.hypot(lmx - (2 * sx + 1) * gs, lmz - (2 * sz + 1) * gs);
          if (rr < gs * CITY_RING_RADIUS_FRAC + city.roadWidth + 4) return true;
        }
        return false;
      };

      const aabb = cityChunkLocalAABB(d, minX, minZ, maxX, maxZ);
      if (!aabb) continue;
      const { lminX, lmaxX, lminZ, lmaxZ } = aabb;

      const inset = city.roadWidth + 4; // keep markers out of grid intersections
      const ix0 = Math.floor(lminX / gs) - 1;
      const ix1 = Math.floor(lmaxX / gs) + 1;
      const iz0 = Math.floor(lminZ / gs) - 1;
      const iz1 = Math.floor(lmaxZ / gs) + 1;
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const cell = cellAt(ix, iz);
          const curL = cell.label;

          // East boundary: x = (ix+1)·gs, z ∈ [iz·gs, (iz+1)·gs]
          if (cellAt(ix + 1, iz).label !== curL) {
            const bx = (ix + 1) * gs;
            for (let z = iz * gs + inset; z <= (iz + 1) * gs - inset; z += streetSpacing) {
              if (insideRoundabout(bx, z)) continue;
              emitLocalMarker(bx, z, 0, 1);
            }
          }

          // North boundary: z = (iz+1)·gs, x ∈ [ix·gs, (ix+1)·gs]
          if (cellAt(ix, iz + 1).label !== curL) {
            const bz = (iz + 1) * gs;
            for (let x = ix * gs + inset; x <= (ix + 1) * gs - inset; x += streetSpacing) {
              if (insideRoundabout(x, bz)) continue;
              emitLocalMarker(x, bz, 1, 0);
            }
          }

          if (cell.shape === CITY_SHAPE_TRI_NE || cell.shape === CITY_SHAPE_TRI_NW) {
            // Emitted from the super-cell's anchor cell only.
            const sx = Math.floor(ix / 2);
            const sz = Math.floor(iz / 2);
            if (ix !== 2 * sx || iz !== 2 * sz) continue;
            const side = 2 * gs;
            const diagLen = side * Math.SQRT2;
            const dirX = Math.SQRT1_2;
            const dirZ = cell.shape === CITY_SHAPE_TRI_NE ? Math.SQRT1_2 : -Math.SQRT1_2;
            const startX = 2 * sx * gs;
            const startZ = cell.shape === CITY_SHAPE_TRI_NE ? 2 * sz * gs : 2 * sz * gs + side;
            const diagInset = inset * Math.SQRT1_2 + city.roadWidth;
            for (let t = diagInset; t <= diagLen - diagInset; t += streetSpacing) {
              emitLocalMarker(startX + dirX * t, startZ + dirZ * t, dirX, dirZ);
            }
          } else if (cell.shape === CITY_SHAPE_CIRCLE) {
            // Emitted from the super-cell's anchor cell only; markers ring the island tangentially.
            const sx = Math.floor(ix / 2);
            const sz = Math.floor(iz / 2);
            if (ix !== 2 * sx || iz !== 2 * sz) continue;
            const scx = (2 * sx + 1) * gs;
            const scz = (2 * sz + 1) * gs;
            const ringR = gs * CITY_RING_RADIUS_FRAC;
            const count = Math.max(8, Math.round((2 * Math.PI * ringR) / streetSpacing));
            for (let i = 0; i < count; i++) {
              const a = (i / count) * 2 * Math.PI;
              emitLocalMarker(scx + Math.cos(a) * ringR, scz + Math.sin(a) * ringR, -Math.sin(a), Math.cos(a));
            }
          }
        }
      }
    }
  }
};

/** Arterial centerlines: markers on GLOBAL parameter lattices (duplicate-free across chunks),
 *  oriented along the wiggle tangent, clear of the junctions. */
const emitArterialMarkers = (minX: number, minZ: number, maxX: number, maxZ: number, freewaySpacing: number, emit: EmitMarker): void => {
  const pitch = cityDistrictPitch();
  const fwClear = domainConfig!.cityConfig.freewayWidth + 6;

  // Horizontal row-boundary curves (full-width; between rows k−1 and k)
  for (let k = Math.floor(minZ / pitch) - 1; k <= Math.floor(maxZ / pitch) + 2; k++) {
    const bzBase = cityRowBoundary(k);
    if (bzBase < minZ - CITY_WIGGLE_AMP || bzBase >= maxZ + CITY_WIGGLE_AMP) continue;
    for (let j = Math.ceil(minX / freewaySpacing); j * freewaySpacing < maxX; j++) {
      const mx = j * freewaySpacing;
      const mz = cityRowEdgeZ(k, mx);
      if (mz < minZ || mz >= maxZ) continue; // ownership by actual (wiggled) position
      // skip T-junctions with the vertical boundaries of both adjacent rows
      let nearVertical = false;
      for (const rr of [k - 1, k]) {
        const mm = findCitySeg(rr, mx, mz);
        if (
          Math.abs(mx - citySegEdgeX(rr, mm, mz)) < fwClear ||
          Math.abs(mx - citySegEdgeX(rr, mm + 1, mz)) < fwClear
        ) {
          nearVertical = true;
          break;
        }
      }
      if (nearVertical) continue;
      const slope = cityWiggleSlope(rowWiggle(k), mx);
      const norm = Math.hypot(1, slope);
      emit(mx, mz, 1 / norm, slope / norm);
    }
  }

  // Vertical segment-boundary curves (within each row)
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const [rows0, rows1] = chunkRowRange(minZ, maxZ, midX);
  for (let r = rows0; r <= rows1; r++) {
    const [m0, m1] = chunkSegRange(r, minX, maxX, midZ);
    for (let m = m0; m <= m1 + 1; m++) {
      const bxBase = citySegBoundary(r, m);
      if (bxBase < minX - CITY_WIGGLE_AMP || bxBase >= maxX + CITY_WIGGLE_AMP) continue;
      for (let j = Math.ceil(minZ / freewaySpacing); j * freewaySpacing < maxZ; j++) {
        const mz = j * freewaySpacing;
        const mx = citySegEdgeX(r, m, mz);
        if (mx < minX || mx >= maxX) continue; // ownership by actual (wiggled) position
        // clamp to this row's (wiggled) span and skip row-boundary junctions
        const rz0 = cityRowEdgeZ(r, mx);
        const rz1 = cityRowEdgeZ(r + 1, mx);
        if (mz - rz0 < fwClear || rz1 - mz < fwClear) continue;
        const slope = cityWiggleSlope(segWiggle(r, m), mz);
        const norm = Math.hypot(1, slope);
        emit(mx, mz, slope / norm, 1 / norm);
      }
    }
  }
};

/** Belt median markers: step along the city's WALL segments in warped space (the belt's centerline
 *  is the wall), invert the road-noise warp; off-city candidates die in the filters. */
const emitBeltMarkers = (minX: number, minZ: number, maxX: number, maxZ: number, freewaySpacing: number, out: RoadMarkerPoint[]): void => {
  const city = domainConfig!.cityConfig;
  for (const wall of cityWallsAround(minX, minZ, maxX, maxZ)) {
    if (!isCanonicalWall(wall)) continue;
    const wdx = wall.ex - wall.sx;
    const wdz = wall.ez - wall.sz;
    const wlen = Math.hypot(wdx, wdz);
    if (wlen < freewaySpacing) continue;
    const ux = wdx / wlen;
    const uz = wdz / wlen;
    for (let t = freewaySpacing / 2; t < wlen; t += freewaySpacing) {
      // The centerline IS the wall: a marker may fall a hair to either side of it, so the
      // biome is not checked — the wall being a city wall is what qualifies it.
      const { x: mx, z: mz } = unwarp(wall.sx + ux * t, wall.sz + uz * t);
      if (mx < minX || mx >= maxX || mz < minZ || mz >= maxZ) continue; // chunk ownership
      const vd = computeVertexData(mx, mz);
      if (vd.distanceToBiomeBoundaryCenter > 2.5) continue;
      if (vd.distanceToRoadCenter > 2) continue;
      if (vd.distanceToRiverCenter < riverKeepOff() || vd.underDeck > 0) continue;
      if (vd.distanceToFreewayCenter >= NO_ROAD_DISTANCE) continue; // a run merges here: no median studs in the mouth
      // yield to arterial junctions like all markers do
      if (cityArterialDist(mx, mz, getCityDistrict(mx, mz)) < city.freewayWidth + 6) continue;
      out.push({ x: mx, y: vd.height, z: mz, dirX: ux, dirZ: uz });
    }
  }
};

/** Median markers along every inter-city run, `spacing` apart on the run's own arc lattice
 *  (identical from every chunk), outside the city and off the river channel. The city's
 *  belt/arterial markers come from getCityRoadMarkers; this is its off-city sibling. */
export function getFreewayRunMarkers(minX: number, minZ: number, maxX: number, maxZ: number, spacing: number): RoadMarkerPoint[] {
  if (!domainConfig) return [];
  const center = warp((minX + maxX) / 2, (minZ + maxZ) / 2);
  const out: RoadMarkerPoint[] = [];
  for (const r of getNetwork(center).freeways) {
    for (let s = spacing / 2; s < r.length; s += spacing) {
      const wp = freewayPointAt(r, s);
      const p = unwarp(wp.x, wp.z);
      if (p.x < minX || p.x >= maxX || p.z < minZ || p.z >= maxZ) continue;
      const vd = computeVertexData(p.x, p.z);
      if (vd.biomeId === CITY_BIOME_ID || vd.distanceToFreewayCenter > 1.5 || vd.underDeck > 0) continue;
      const ahead = freewayPointAt(r, Math.min(r.length, s + 1));
      const behind = freewayPointAt(r, Math.max(0, s - 1));
      const dl = Math.hypot(ahead.x - behind.x, ahead.z - behind.z) || 1;
      out.push({ x: p.x, y: vd.height, z: p.z, dirX: (ahead.x - behind.x) / dl, dirZ: (ahead.z - behind.z) / dl });
    }
  }
  return out;
}
