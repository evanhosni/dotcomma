/**
 * Points beside the city's FREEWAYS (arterials and the belt): the power-line poles' placement
 * (tests: cityFeatures.test.ts).
 */

import { CITY_BIOME_ID } from "../../../world/constants";
import { FREEWAY_CORRIDOR_OUTER } from "../../../world/shaders/constants";
import { domainConfig } from "../computeConfig";
import { unwarp } from "../noise";
import { riverKeepOff } from "../rivers/constants";
import type { Wall } from "../types";
import { computeVertexData } from "../vertexCompute";
import { isCanonicalWall } from "../voronoi";
import { cityWallsAround, chunkRowRange, chunkSegRange } from "./cityChunks";
import {
  CITY_WIGGLE_AMP,
  cityArterialDist,
  cityDistrictPitch,
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

export interface CityFreewaySidePoint {
  x: number;
  y: number; // terrain height at the point
  z: number;
  dirX: number; // unit tangent along the freeway
  dirZ: number;
  side: number; // +1 / −1: which side of the centerline (belt: +1 = city side)
  next?: { x: number; y: number; z: number }; // next point along the run (wire spans)
}

/** The plaza band's start (the city shader's sidewalk ends at ROAD_HALF_WIDTH + 5). */
const SIDE_POINT_MAX_FIELD = 12;

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
  // …and points past the sidewalk band: where the belt runs off its wall onto the waterfront, a point
  // offset from the wall stood in a block's plaza.
  const maxField = SIDE_POINT_MAX_FIELD;
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
    if (vd.distanceToRoadCenter < minField || vd.distanceToRoadCenter >= maxField) return null;
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
    if (vd.distanceToRoadCenter < minField || vd.distanceToRoadCenter >= maxField) return null;
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
