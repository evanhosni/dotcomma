/**
 * The two nested voronoi grids — REGION (regionGridSize) → BIOME (gridSize) — in warped space:
 * jittered sites, the element each cell rolls, the 5×5 grids a query sees, their Delaunay
 * triangulations and the zone walls between them.
 *
 * Each cell rolls its element from the enclosing level's list with the SAME `${x},${z}` seed the
 * biome grid always used. The jitter seeds are rolled IDENTICALLY by gridSite (the site caches, the
 * place queries) and by getCityVoronoiSites — change them together or the biome map disagrees with
 * itself. Sites and rolls are cached per cell: three seedRand calls per site per grid build were
 * most of what a grid miss cost, and far-LOD terrain and the river network miss constantly.
 */

import Delaunator from "delaunator";
import { seedRand } from "../math/_math";
import type { PointXZ } from "../math/types";
import { CellCache } from "./cellCache";
import { domainConfig } from "./computeConfig";
import type { BiomeContext, SerializedRegion, VoronoiCell, Wall, Zone } from "./types";
import { zoneByKey, zonesByRegion } from "./zoneBlend";

export const gridSite = (seed: string, ix: number, iz: number, gs: number): PointXZ => ({
  x: (ix + seedRand(`${seed} - ${ix}X${iz}`)) * gs,
  z: (iz + seedRand(`${seed} - ${ix}Z${iz}`)) * gs,
});

export const rollRegion = (point: PointXZ, regions: SerializedRegion[]): SerializedRegion => {
  const uuid = seedRand(`${point.x},${point.z}`);
  return regions[Math.floor(uuid * regions.length)];
};

export const rollZone = (point: PointXZ, rGrid: VoronoiCell[]): Zone => {
  const region: SerializedRegion = nearestCell(point, rGrid).element;
  const uuid = seedRand(`${point.x},${point.z}`);
  const biome = region.biomes[Math.floor(uuid * region.biomes.length)];
  return zoneByKey.get(`${region.id}/${biome.id}`)!;
};

// ── Site caches ───────────────────────────────────────────────────────────

interface RegionSite {
  x: number;
  z: number;
  region: SerializedRegion;
}
const regionSites = new CellCache<RegionSite>(16384);
export const regionSiteAt = (ix: number, iz: number): RegionSite => {
  let site = regionSites.get(ix, iz);
  if (!site) {
    regionSites.makeRoom();
    const p = gridSite(`${domainConfig!.seed} - regionGrid`, ix, iz, domainConfig!.regionGridSize);
    site = { x: p.x, z: p.z, region: rollRegion(p, domainConfig!.regions) };
    regionSites.set(ix, iz, site);
  }
  return site;
};

/** A biome-grid cell's site and its biome roll — the three seedRand calls rollZone makes for it,
 *  cached per cell: a network window re-reads 1369 sites, 97% of them shared with the neighboring
 *  cell's window (MEASURED: seedRand was ~80% of a 56ms network build). */
interface RawBiomeSite {
  x: number;
  z: number;
  roll: number;
}
const rawBiomeSites = new CellCache<RawBiomeSite>(65536);
export const rawBiomeSiteAt = (ix: number, iz: number): RawBiomeSite => {
  let site = rawBiomeSites.get(ix, iz);
  if (!site) {
    rawBiomeSites.makeRoom();
    const p = gridSite(`${domainConfig!.seed} - grid`, ix, iz, domainConfig!.gridSize);
    site = { x: p.x, z: p.z, roll: seedRand(`${p.x},${p.z}`) };
    rawBiomeSites.set(ix, iz, site);
  }
  return site;
};
/** rollZone for a cached site: the same region lookup, the same roll. */
export const zoneOfRawSite = (site: RawBiomeSite, rGrid: VoronoiCell[]): Zone => {
  const region: SerializedRegion = nearestCell(site, rGrid).element;
  return zonesByRegion.get(region)![Math.floor(site.roll * region.biomes.length)];
};

// Biome-grid sites + their zones, cached per cell: the network build and the bridge paths look up
// zones all over a ~20km window, where getBiomeGrid's per-query 5×5 grids evict each other.
interface BiomeSite {
  x: number;
  z: number;
  zone: Zone;
}
const biomeSites = new CellCache<BiomeSite>(65536);
export const biomeSiteAt = (ix: number, iz: number): BiomeSite => {
  let site = biomeSites.get(ix, iz);
  if (!site) {
    biomeSites.makeRoom();
    const p = rawBiomeSiteAt(ix, iz);
    site = { x: p.x, z: p.z, zone: zoneOfRawSite(p, getRegionGrid(p)) };
    biomeSites.set(ix, iz, site);
  }
  return site;
};
/** The biome-grid site nearest a warped point (the same 5×5 candidates getBiomeGrid uses). */
export const nearestBiomeSite = (x: number, z: number): BiomeSite => {
  const gs = domainConfig!.gridSize;
  const cx = Math.floor(x / gs);
  const cz = Math.floor(z / gs);
  let best = biomeSiteAt(cx, cz);
  let bestD = (best.x - x) ** 2 + (best.z - z) ** 2;
  for (let ix = cx - 2; ix <= cx + 2; ix++) {
    for (let iz = cz - 2; iz <= cz + 2; iz++) {
      const s = biomeSiteAt(ix, iz);
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
  }
  return best;
};
export const zoneAtWarped = (x: number, z: number): Zone => nearestBiomeSite(x, z).zone;

// ── Grids ─────────────────────────────────────────────────────────────────

export const nearestCell = (point: PointXZ, grid: VoronoiCell[]): VoronoiCell => {
  let minDist = Infinity;
  let nearest = grid[0];
  for (let i = 0; i < grid.length; i++) {
    const dx = point.x - grid[i].point.x;
    const dz = point.z - grid[i].point.z;
    const d = dx * dx + dz * dz;
    if (d < minDist) {
      minDist = d;
      nearest = grid[i];
    }
  }
  return nearest;
};

const twoNearestCells = (px: number, pz: number, grid: VoronoiCell[]): [VoronoiCell, VoronoiCell] => {
  let min1 = Infinity;
  let min2 = Infinity;
  let idx1 = 0;
  let idx2 = 1;
  for (let i = 0; i < grid.length; i++) {
    const dx = px - grid[i].point.x;
    const dz = pz - grid[i].point.z;
    const d = dx * dx + dz * dz;
    if (d < min1) {
      min2 = min1;
      idx2 = idx1;
      min1 = d;
      idx1 = i;
    } else if (d < min2) {
      min2 = d;
      idx2 = i;
    }
  }
  return [grid[idx1], grid[idx2]];
};

const regionGrids = new CellCache<VoronoiCell[]>(256);
/** Grids by cell (5×5 around it). */
const biomeGrids = new Map<number, Map<number, VoronoiCell[]>>();

export const getRegionGrid = (warped: PointXZ): VoronoiCell[] => {
  const rgs = domainConfig!.regionGridSize;
  const x = Math.floor(warped.x / rgs);
  const z = Math.floor(warped.z / rgs);
  let grid = regionGrids.get(x, z);
  if (grid) return grid;
  regionGrids.makeRoom();
  grid = [];
  for (let ix = x - 2; ix <= x + 2; ix++) {
    for (let iz = z - 2; iz <= z + 2; iz++) {
      const site = regionSiteAt(ix, iz);
      grid.push({ point: { x: site.x, z: site.z }, element: site.region, ix, iz });
    }
  }
  regionGrids.set(x, z, grid);
  return grid;
};

export const getBiomeGrid = (warped: PointXZ): VoronoiCell[] => {
  const gs = domainConfig!.gridSize;
  const x = Math.floor(warped.x / gs);
  const z = Math.floor(warped.z / gs);
  let row = biomeGrids.get(x);
  let grid = row?.get(z);
  if (grid) return grid;
  const rGrid = getRegionGrid(warped);
  grid = [];
  for (let ix = x - 2; ix <= x + 2; ix++) {
    for (let iz = z - 2; iz <= z + 2; iz++) {
      const site = rawBiomeSiteAt(ix, iz);
      grid.push({ point: { x: site.x, z: site.z }, element: zoneOfRawSite(site, rGrid), ix, iz });
    }
  }
  row = biomeGrids.get(x);
  if (!row) biomeGrids.set(x, (row = new Map()));
  row.set(z, grid);
  // Grids more than 5 cells from the latest miss drop — the retention the wall memos (keyed by
  // grid identity) and getZoneWalls' sides cache were tuned under.
  for (const [cx, r] of biomeGrids) {
    if (Math.abs(x - cx) > 5) biomeGrids.delete(cx);
    else for (const cz of r.keys()) if (Math.abs(z - cz) > 5) r.delete(cz);
  }
  return grid;
};

const delaunayCache = new WeakMap<
  VoronoiCell[],
  { delaunay: Delaunator<ArrayLike<number>>; circumcenters: number[] }
>();

const getDelaunayData = (grid: VoronoiCell[]) => {
  let cached = delaunayCache.get(grid);
  if (cached) return cached;

  const coords = new Float64Array(grid.length * 2);
  for (let i = 0; i < grid.length; i++) {
    coords[i * 2] = grid[i].point.x;
    coords[i * 2 + 1] = grid[i].point.z;
  }
  const delaunay = new Delaunator(coords);

  const circumcenters: number[] = [];
  for (let i = 0; i < delaunay.triangles.length; i += 3) {
    const ai = delaunay.triangles[i];
    const bi = delaunay.triangles[i + 1];
    const ci = delaunay.triangles[i + 2];
    const ax = grid[ai].point.x,
      az = grid[ai].point.z;
    const bx = grid[bi].point.x,
      bz = grid[bi].point.z;
    const cx = grid[ci].point.x,
      cz = grid[ci].point.z;

    const ad = ax * ax + az * az;
    const bd = bx * bx + bz * bz;
    const cd = cx * cx + cz * cz;
    const D = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
    circumcenters.push(
      (1 / D) * (ad * (bz - cz) + bd * (cz - az) + cd * (az - bz)),
      (1 / D) * (ad * (cx - bx) + bd * (ax - cx) + cd * (bx - ax))
    );
  }

  cached = { delaunay, circumcenters };
  delaunayCache.set(grid, cached);
  return cached;
};

// ── Zone walls ────────────────────────────────────────────────────────────

/** Which two cells a wall midpoint lies between, by its floored midpoint, with the biome cell
 *  whose grid first found it (swept 5 cells out). */
let wallSides: { [label: string]: { grid: [number, number]; a: VoronoiCell; b: VoronoiCell } } = {};
// Memoized on grid identity: rebuilding the wall list per vertex (~900k string
// allocations per LOD1 chunk) was the dominant chunk-build cost.
const zoneWallsCache = new WeakMap<VoronoiCell[], Wall[]>();

/** Every wall between two DIFFERENT zones (or two cells of a non-joinable biome) of a biome grid
 *  around `currentVertex`. A region edge is just a zone wall whose sides differ in region — it
 *  blends like any other. Each wall appears twice, endpoint-swapped. */
export const getZoneWalls = (currentVertex: PointXZ, grid: VoronoiCell[]): Wall[] => {
  const memo = zoneWallsCache.get(grid);
  if (memo) return memo;

  const gridSize = domainConfig!.gridSize;
  const x = Math.floor(currentVertex.x / gridSize);
  const z = Math.floor(currentVertex.z / gridSize);
  const cache = wallSides;

  const { delaunay, circumcenters } = getDelaunayData(grid);

  const zoneWalls: Wall[] = [];
  let swept = false;

  for (let i = 0; i < delaunay.halfedges.length; i++) {
    const edge = delaunay.halfedges[i];
    if (edge === -1) continue;

    const t1 = Math.floor(i / 3);
    const t2 = Math.floor(edge / 3);
    const v1x = circumcenters[t1 * 2],
      v1z = circumcenters[t1 * 2 + 1];
    const v2x = circumcenters[t2 * 2],
      v2z = circumcenters[t2 * 2 + 1];

    const midX = (v1x + v2x) / 2;
    const midZ = (v1z + v2z) / 2;
    const label = `${Math.floor(midX)},${Math.floor(midZ)}`;

    let sides = cache[label];
    if (sides === undefined) {
      const [nearest1, nearest2] = twoNearestCells(midX, midZ, grid);
      sides = { grid: [x, z] as [number, number], a: nearest1, b: nearest2 };
      cache[label] = sides;

      // One sweep per build is exactly a sweep after every new label: what this build adds carries
      // its own cell, so later sweeps in the same build never find anything to drop.
      if (!swept) {
        swept = true;
        for (const key in cache) {
          const cachedData = cache[key];
          if (cachedData.grid) {
            const [cx, cz] = cachedData.grid;
            if (Math.abs(x - cx) > 5 || Math.abs(z - cz) > 5) {
              delete cache[key];
            }
          }
        }
      }
    }

    const a = sides.a.element as Zone;
    const b = sides.b.element as Zone;
    if (a === b && a.biome.joinable) continue;

    let nx = sides.b.point.x - sides.a.point.x;
    let nz = sides.b.point.z - sides.a.point.z;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;

    zoneWalls.push({
      sx: v1x,
      sz: v1z,
      ex: v2x,
      ez: v2z,
      a,
      b,
      nx,
      nz,
      materialHalf: a.biome.id === b.biome.id ? -1 : Math.min(a.blendHalf, b.blendHalf),
    });
  }

  zoneWallsCache.set(grid, zoneWalls);
  return zoneWalls;
};

/** A warped point's biome cell, its zone, the zone walls in reach and the 5×5 grid they came from. */
export const getBiomeContext = (currentVertex: PointXZ): BiomeContext => {
  const biomeGrid = getBiomeGrid(currentVertex);
  const cell = nearestCell(currentVertex, biomeGrid);
  const zone: Zone = cell.element;
  return { zone, cell, zoneWalls: getZoneWalls(currentVertex, biomeGrid), grid: biomeGrid, warped: currentVertex };
};

// The walls that bound a given biome, filtered once per wall list (the city's rim /
// belt logic measures against the CITY's boundary only — a wall between two foreign
// zones near a triple junction must not read as the rim).
const biomeWallsCache = new WeakMap<Wall[], Map<number, Wall[]>>();
export const wallsOfBiome = (zoneWalls: Wall[], biomeId: number): Wall[] => {
  let byBiome = biomeWallsCache.get(zoneWalls);
  if (!byBiome) {
    byBiome = new Map();
    biomeWallsCache.set(zoneWalls, byBiome);
  }
  let walls = byBiome.get(biomeId);
  if (!walls) {
    walls = zoneWalls.filter((w) => w.a.biome.id === biomeId || w.b.biome.id === biomeId);
    byBiome.set(biomeId, walls);
  }
  return walls;
};

/** getZoneWalls emits each wall twice, endpoint-swapped: this picks one of the two. */
export const isCanonicalWall = (w: Wall): boolean => !(w.ex < w.sx || (w.ex === w.sx && w.ez < w.sz));

export const distanceToWall = (px: number, pz: number, walls: Wall[]): number => {
  let minDistSq = Infinity;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const dx = w.ex - w.sx;
    const dz = w.ez - w.sz;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((px - w.sx) * dx + (pz - w.sz) * dz) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = w.sx + t * dx;
    const cz = w.sz + t * dz;
    const ddx = px - cx, ddz = pz - cz;
    const distSq = ddx * ddx + ddz * ddz;
    if (distSq < minDistSq) minDistSq = distSq;
  }
  return minDistSq === Infinity ? Infinity : Math.sqrt(minDistSq);
};

/** Everything keyed by seed or by config-derived objects is stale across an init. */
export const clearVoronoiCaches = (): void => {
  wallSides = {};
  regionSites.clear();
  regionGrids.clear();
  biomeGrids.clear();
  rawBiomeSites.clear();
  biomeSites.clear();
};
