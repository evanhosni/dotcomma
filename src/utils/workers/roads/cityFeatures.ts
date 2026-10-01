/**
 * DRESSING ENUMERATORS for the road network: raised road markers, traffic signals, freeway-side
 * poles, city-light sites and the inter-city run markers. Each is deterministic and duplicate-free
 * under chunked queries — ownership by world position — and validates its candidates through
 * computeVertexData (tests: cityFeatures.test.ts).
 */

import { seedRand } from "../../math/_math";
import { CITY_BIOME_ID } from "../../../world/constants";
import { FREEWAY_CORRIDOR_OUTER } from "../../../world/shaders/constants";
import {
  CITY_RING_RADIUS_FRAC,
  CITY_SHAPE_CIRCLE,
  CITY_SHAPE_TRI_NE,
  CITY_SHAPE_TRI_NW,
  CITY_WIGGLE_AMP,
  type CityCell,
  type CityDistrict,
  cityArterialDist,
  cityDistrictByIndex,
  cityDistrictPitch,
  cityLocalToWorld,
  cityRowBoundary,
  cityRowEdgeZ,
  citySegBoundary,
  citySegEdgeX,
  cityWiggleSlope,
  findCityRow,
  findCitySeg,
  getCityCell,
  getCityDistrict,
  peekCityCell,
  rowWiggle,
  segWiggle,
} from "./cityTerrain";
import { domainConfig } from "../computeConfig";
import { computeVertexDataRaw } from "../flattenPads";
import { freewayPointAt, getNetwork } from "./freewayNetwork";
import { unwarp, warp } from "../noise";
import { riverKeepOff } from "../rivers/riverNetwork";
import type { Wall } from "../types";
import { computeVertexData } from "../vertexCompute";
import { biomeSiteAt, getBiomeContext, isCanonicalWall, cityWallsOf } from "../voronoi";

const cityCellAtLocal = (ix: number, iz: number, d: CityDistrict): CityCell => {
  // Cache-first: the walls/noise context costs 2 FBMs + a voronoi lookup, too much to pay on hits.
  const cached = peekCityCell(ix, iz, d);
  if (cached) return cached;

  const gs = domainConfig!.cityConfig.gridSize;
  const w = cityLocalToWorld((ix + 0.5) * gs, (iz + 0.5) * gs, d);
  return getCityCell(ix, iz, cityWallsOf(getBiomeContext(warp(w.x, w.z))), d);
};

/** The CITY walls (the belt) around a chunk: the biome context of its center. Belt candidates
 *  therefore depend on the query center's wall set — keep chunk size consistent. */
const cityWallsAround = (minX: number, minZ: number, maxX: number, maxZ: number): Wall[] =>
  cityWallsOf(getBiomeContext(warp((minX + maxX) / 2, (minZ + maxZ) / 2)));

/** District-frame AABB of the chunk∩district overlap (padded by the wiggle amplitude); null when disjoint. */
const cityChunkLocalAABB = (
  d: CityDistrict,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): { lminX: number; lmaxX: number; lminZ: number; lmaxZ: number } | null => {
  const wx0 = Math.max(minX, d.minX - CITY_WIGGLE_AMP);
  const wx1 = Math.min(maxX, d.maxX + CITY_WIGGLE_AMP);
  const wz0 = Math.max(minZ, d.minZ - CITY_WIGGLE_AMP);
  const wz1 = Math.min(maxZ, d.maxZ + CITY_WIGGLE_AMP);
  if (wx0 >= wx1 || wz0 >= wz1) return null;
  let lminX = Infinity;
  let lmaxX = -Infinity;
  let lminZ = Infinity;
  let lmaxZ = -Infinity;
  for (const [cxw, czw] of [
    [wx0, wz0],
    [wx0, wz1],
    [wx1, wz0],
    [wx1, wz1],
  ]) {
    const dx = cxw - d.px;
    const dz = czw - d.pz;
    const lcx = d.px + dx * d.cos + dz * d.sin;
    const lcz = d.pz - dx * d.sin + dz * d.cos;
    if (lcx < lminX) lminX = lcx;
    if (lcx > lmaxX) lmaxX = lcx;
    if (lcz < lminZ) lminZ = lcz;
    if (lcz > lmaxZ) lmaxZ = lcz;
  }
  return { lminX, lmaxX, lminZ, lmaxZ };
};

// ── Road markers (raised pavement markers along road centerlines) ────────────────────────────────

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
    if (computeVertexData(mx, mz).distanceToFreewayCenter > 99990) return;
    emitIfOnRoadCenter(mx, mz, dirX, dirZ);
  };
  emitStreetMarkers(minX, minZ, maxX, maxZ, streetSpacing, emitIfOnRoadCenter);
  emitArterialMarkers(minX, minZ, maxX, maxZ, freewaySpacing, emitIfOnPaintedFreeway);
  emitBeltMarkers(minX, minZ, maxX, maxZ, freewaySpacing, out);
  return out;
}

/** The district rows a chunk can touch, padded ±1 for the wiggle. */
const chunkRowRange = (minZ: number, maxZ: number, midX: number): [number, number] => [findCityRow(minZ, midX) - 1, findCityRow(maxZ - 0.001, midX) + 1];
/** Row r's district segments a chunk can touch, padded ±1 for the wiggle. */
const chunkSegRange = (r: number, minX: number, maxX: number, midZ: number): [number, number] => [findCitySeg(r, minX, midZ) - 1, findCitySeg(r, maxX - 0.001, midZ) + 1];

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
      if (vd.distanceToFreewayCenter > 99990) continue; // a run merges here: no median studs in the mouth
      // yield to arterial junctions like all markers do
      if (cityArterialDist(mx, mz, getCityDistrict(mx, mz)) < city.freewayWidth + 6) continue;
      out.push({ x: mx, y: vd.height, z: mz, dirX: ux, dirZ: uz });
    }
  }
};

// ── City voronoi sites (one per city-biome cell — used by CityLights) ────────────────────────────

export interface CitySitePoint {
  key: string; // biome-grid cell key — stable identity across queries
  x: number;
  y: number; // terrain height at the site
  z: number;
}

/** The voronoi SITE of every biome-grid cell in the bounds that rolled the city biome,
 *  warp-inverted to real world space. */
export function getCityVoronoiSites(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): CitySitePoint[] {
  if (!domainConfig) throw new Error("vertexCompute not initialized");
  const gs = domainConfig.gridSize;
  const out: CitySitePoint[] = [];
  // Pad one cell ring: the warp shifts sites by less than a cell.
  const ix0 = Math.floor(minX / gs) - 1;
  const ix1 = Math.floor(maxX / gs) + 1;
  const iz0 = Math.floor(minZ / gs) - 1;
  const iz1 = Math.floor(maxZ / gs) + 1;

  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const site = biomeSiteAt(ix, iz);
      if (site.zone.biome.id !== CITY_BIOME_ID) continue;
      const { x: wx, z: wz } = unwarp(site.x, site.z);
      // RAW height: the beacon floats heightOffset above anyway, and the padded path would build a pad tile per site.
      out.push({ key: `${ix},${iz}`, x: wx, y: computeVertexDataRaw(wx, wz).height, z: wz });
    }
  }

  return out;
}

// ── Traffic lights (signalized street intersections) ─────────────────────────────────────────────

export interface CityTrafficLightPoint {
  x: number;
  y: number; // terrain height at the pole base (sidewalk corner)
  z: number;
  dirX: number; // unit direction the signal head faces (toward the intersection)
  dirZ: number;
  phase: number; // seeded [0,1) — desynchronizes the per-light signal cycles
}

/** Seeded roll per intersection (a grid corner where ≥3 road arms meet); one
 *  pole per block corner, marched diagonally out until the road field says
 *  sidewalk. Ownership by the CORNER's world position keeps chunked calls
 *  duplicate-free even when an intersection straddles a border. */
export function getCityTrafficLightPoints(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  chance: number
): CityTrafficLightPoint[] {
  if (!domainConfig || !domainConfig.cityConfig) return [];
  const city = domainConfig.cityConfig;
  const gs = city.gridSize;
  const out: CityTrafficLightPoint[] = [];

  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const [rows0, rows1] = chunkRowRange(minZ, maxZ, midX);
  for (let r = rows0; r <= rows1; r++) {
    const [m0, m1] = chunkSegRange(r, minX, maxX, midZ);
    for (let m = m0; m <= m1; m++) {
      const d = cityDistrictByIndex(r, m);
      const aabb = cityChunkLocalAABB(d, minX, minZ, maxX, maxZ);
      if (!aabb) continue;

      const ix0 = Math.floor(aabb.lminX / gs) - 1;
      const ix1 = Math.floor(aabb.lmaxX / gs) + 2;
      const iz0 = Math.floor(aabb.lminZ / gs) - 1;
      const iz1 = Math.floor(aabb.lmaxZ / gs) + 2;
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          // Corner at local (ix·gs, iz·gs); the four cells around it.
          const A = cityCellAtLocal(ix - 1, iz - 1, d);
          const B = cityCellAtLocal(ix, iz - 1, d);
          const C = cityCellAtLocal(ix - 1, iz, d);
          const D = cityCellAtLocal(ix, iz, d);
          // Rim cells and roundabout territory never get signals.
          if (A.label < 0 || B.label < 0 || C.label < 0 || D.label < 0) continue;
          if (
            A.shape === CITY_SHAPE_CIRCLE ||
            B.shape === CITY_SHAPE_CIRCLE ||
            C.shape === CITY_SHAPE_CIRCLE ||
            D.shape === CITY_SHAPE_CIRCLE
          )
            continue;
          const arms =
            (A.label !== B.label ? 1 : 0) + // south arm
            (C.label !== D.label ? 1 : 0) + // north arm
            (A.label !== C.label ? 1 : 0) + // west arm
            (B.label !== D.label ? 1 : 0); // east arm
          if (arms < 3) continue;
          if (seedRand(`${city.seed}-tl-${d.key}|${ix},${iz}`) >= chance) continue;

          const pc = cityLocalToWorld(ix * gs, iz * gs, d);
          if (pc.x < minX || pc.x >= maxX || pc.z < minZ || pc.z >= maxZ) continue;
          if (getCityDistrict(pc.x, pc.z).key !== d.key) continue; // wiggly district clip
          // The arterial chamfer eats these corners.
          if (cityArterialDist(pc.x, pc.z, d) < city.freewayWidth + 16) continue;

          const lx = ix * gs;
          const lz = iz * gs;
          for (const [sx, sz] of [
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ]) {
            // The chamfer cuts corners at varying depths, so march until the field says sidewalk.
            for (let off = 16; off <= 26; off += 2) {
              const p = cityLocalToWorld(
                lx + sx * off * Math.SQRT1_2,
                lz + sz * off * Math.SQRT1_2,
                d
              );
              const vd = computeVertexData(p.x, p.z);
              if (vd.biomeId !== CITY_BIOME_ID || vd.distanceToRiverCenter < riverKeepOff() || vd.underDeck > 0) break;
              // Strictly inside the belt ring, one-sided (see the road markers).
              if (vd.distanceToBiomeBoundaryCenter < city.freewayWidth + 5)
                break;
              if (vd.distanceToRoadCenter < 8.4) continue; // still on road/curb
              if (vd.distanceToRoadCenter > 11.6) break; // past the sidewalk — no footing
              const fx = -sx * Math.SQRT1_2;
              const fz = -sz * Math.SQRT1_2;
              out.push({
                x: p.x,
                y: vd.height,
                z: p.z,
                dirX: fx * d.cos - fz * d.sin,
                dirZ: fx * d.sin + fz * d.cos,
                phase: seedRand(`${city.seed}-tlph-${d.key}|${ix},${iz}|${sx},${sz}`),
              });
              break;
            }
          }
        }
      }
    }
  }

  return out;
}

// ── Freeway-side features (power lines along arterials + belt) ───────────────────────────────────

export interface CityFreewaySidePoint {
  x: number;
  y: number; // terrain height at the point
  z: number;
  dirX: number; // unit tangent along the freeway
  dirZ: number;
  side: number; // +1 / −1: which side of the centerline (belt: +1 = city side)
  next?: { x: number; y: number; z: number }; // next point along the run (wire spans)
}

/** Points `lateral` real units to both sides of every freeway centerline
 *  (arterials + belt), `spacing` apart, with the tangent direction. Candidates
 *  near a crossing freeway (junctionClear) or melted into road drop out. With
 *  `withNext` each point carries its successor so wires span chunk borders.
 *  Belt candidates depend on the query center's wall set — keep chunk size consistent. */
export function getCityFreewaySidePoints(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  spacing: number,
  lateral: number,
  junctionClear: number,
  withNext: boolean
): CityFreewaySidePoint[] {
  if (!domainConfig || !domainConfig.cityConfig) return [];
  const city = domainConfig.cityConfig;
  const freewayToStreetScale = city.roadWidth / city.freewayWidth;
  const minField = lateral * freewayToStreetScale - 1.5; // reject points melted into road
  const out: CityFreewaySidePoint[] = [];

  type Candidate = { x: number; y: number; z: number; dirX: number; dirZ: number } | null;

  // Ownership BEFORE validation: the belt scan visits every nearby wall for every city chunk
  // (validating unowned candidates is ~10× slower). Next-link lookups skip it — a successor usually
  // lives in the neighbor chunk.
  const chunkOwns = (px: number, pz: number): boolean =>
    px >= minX && px < maxX && pz >= minZ && pz < maxZ;

  const pushWithSuccessor = (p: Candidate, side: number, successor: () => Candidate): void => {
    if (!p) return;
    const point: CityFreewaySidePoint = { ...p, side };
    if (withNext) {
      const n = successor();
      if (n) point.next = { x: n.x, y: n.y, z: n.z };
    }
    out.push(point);
  };

  const validate = (px: number, pz: number, ux: number, uz: number): Candidate => {
    const vd = computeVertexData(px, pz);
    if (vd.biomeId !== CITY_BIOME_ID || vd.distanceToRiverCenter < riverKeepOff() || vd.underDeck > 0) return null;
    // Stay clear of the belt corridor (arterials empty into it).
    if (vd.distanceToBiomeBoundaryCenter < city.freewayWidth + junctionClear)
      return null;
    if (vd.distanceToRoadCenter < minField) return null;
    return { x: px, y: vd.height, z: pz, dirX: ux, dirZ: uz };
  };

  const evalRow = (k: number, j: number, side: number, owned: boolean): Candidate => {
    const mx = j * spacing;
    const mz = cityRowEdgeZ(k, mx);
    const slope = cityWiggleSlope(rowWiggle(k), mx);
    const norm = Math.hypot(1, slope);
    const ux = 1 / norm;
    const uz = slope / norm;
    // Left normal of the tangent, flipped by side.
    const px = mx - uz * lateral * side;
    const pz = mz + ux * lateral * side;
    if (owned && !chunkOwns(px, pz)) return null;
    // Skip T-junctions with the vertical boundaries of both adjacent rows.
    for (const rr of [k - 1, k]) {
      const mm = findCitySeg(rr, mx, mz);
      if (
        Math.abs(mx - citySegEdgeX(rr, mm, mz)) < junctionClear ||
        Math.abs(mx - citySegEdgeX(rr, mm + 1, mz)) < junctionClear
      )
        return null;
    }
    return validate(px, pz, ux, uz);
  };

  const pitch = cityDistrictPitch();
  const pad = CITY_WIGGLE_AMP + lateral + spacing;
  for (let k = Math.floor(minZ / pitch) - 1; k <= Math.floor(maxZ / pitch) + 2; k++) {
    const bzBase = cityRowBoundary(k);
    if (bzBase < minZ - pad || bzBase >= maxZ + pad) continue;
    // Scan padded by `lateral`: the side offset shifts a point up to lateral·slope along the row.
    for (let j = Math.ceil((minX - lateral) / spacing); j * spacing < maxX + lateral; j++) {
      for (const side of [1, -1]) pushWithSuccessor(evalRow(k, j, side, true), side, () => evalRow(k, j + 1, side, false));
    }
  }

  const evalSeg = (r: number, m: number, j: number, side: number, owned: boolean): Candidate => {
    const mz = j * spacing;
    const mx = citySegEdgeX(r, m, mz);
    const slope = cityWiggleSlope(segWiggle(r, m), mz);
    const norm = Math.hypot(1, slope);
    const ux = slope / norm;
    const uz = 1 / norm;
    const px = mx - uz * lateral * side;
    const pz = mz + ux * lateral * side;
    if (owned && !chunkOwns(px, pz)) return null;
    // Clamp to this row's (wiggled) span, clear of the row-boundary junctions.
    const rz0 = cityRowEdgeZ(r, mx);
    const rz1 = cityRowEdgeZ(r + 1, mx);
    if (mz - rz0 < junctionClear || rz1 - mz < junctionClear) return null;
    return validate(px, pz, ux, uz);
  };

  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const [rows0, rows1] = chunkRowRange(minZ, maxZ, midX);
  for (let r = rows0; r <= rows1; r++) {
    const [m0, m1] = chunkSegRange(r, minX, maxX, midZ);
    for (let m = m0; m <= m1 + 1; m++) {
      const bxBase = citySegBoundary(r, m);
      if (bxBase < minX - pad || bxBase >= maxX + pad) continue;
      // Same `lateral` scan pad as the row lattice above.
      for (let j = Math.ceil((minZ - lateral) / spacing); j * spacing < maxZ + lateral; j++) {
        for (const side of [1, -1]) pushWithSuccessor(evalSeg(r, m, j, side, true), side, () => evalSeg(r, m, j + 1, side, false));
      }
    }
  }

  // Belt: same wall-stepping + warp inversion as the belt median markers; side +1 = the city side.
  const evalBelt = (wall: Wall, t: number, s: number, side: number, owned: boolean): Candidate => {
    if (t <= 0 || t >= Math.hypot(wall.ex - wall.sx, wall.ez - wall.sz)) return null;
    const wdx = wall.ex - wall.sx;
    const wdz = wall.ez - wall.sz;
    const wlen = Math.hypot(wdx, wdz);
    const ux = wdx / wlen;
    const uz = wdz / wlen;
    const o = side * lateral;
    const { x: mx, z: mz } = unwarp(wall.sx + ux * t - uz * o * s, wall.sz + uz * t + ux * o * s);
    if (owned && !chunkOwns(mx, mz)) return null;
    const vd = computeVertexData(mx, mz);
    if (vd.biomeId !== CITY_BIOME_ID || vd.distanceToRiverCenter < riverKeepOff() || vd.underDeck > 0) return null;
    if (Math.abs(vd.distanceToBiomeBoundaryCenter - o) > 2.5) return null; // drift / wrong side
    if (vd.distanceToRoadCenter < minField) return null;
    // Yield to the arterials teeing into the belt.
    if (cityArterialDist(mx, mz, getCityDistrict(mx, mz)) < city.freewayWidth + junctionClear)
      return null;
    // Beside a belt that is drawn: not beside a piece of it a river cut off (a road fragment).
    const c = unwarp(wall.sx + ux * t, wall.sz + uz * t);
    if (!(computeVertexData(c.x, c.z).distanceToRoadCenter < FREEWAY_CORRIDOR_OUTER)) return null;
    return { x: mx, y: vd.height, z: mz, dirX: ux, dirZ: uz };
  };
  for (const wall of cityWallsAround(minX, minZ, maxX, maxZ)) {
    if (!isCanonicalWall(wall)) continue;
    const wlen = Math.hypot(wall.ex - wall.sx, wall.ez - wall.sz);
    if (wlen < spacing) continue;
    for (let t = spacing / 2; t < wlen; t += spacing) {
      for (const s of [1, -1]) {
        for (const side of [1, -1]) pushWithSuccessor(evalBelt(wall, t, s, side, true), side, () => evalBelt(wall, t + spacing, s, side, false));
      }
    }
  }

  return out;
}

/** getCityFreewaySidePoints `lateralMargin` past the freeway EDGE (the active config's
 *  freewayWidth added here, so callers never read it) on one `side` only — the power-line poles. */
export function getCityFreewayEdgePoints(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  spacing: number,
  lateralMargin: number,
  junctionClear: number,
  side: number,
  withNext: boolean
): CityFreewaySidePoint[] {
  if (!domainConfig || !domainConfig.cityConfig) return [];
  const lateral = domainConfig.cityConfig.freewayWidth + lateralMargin;
  return getCityFreewaySidePoints(minX, minZ, maxX, maxZ, spacing, lateral, junctionClear, withNext).filter((p) => p.side === side);
}

// ── Freeway run markers — raised pavement markers on the inter-city freeways ─────────────────────

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
