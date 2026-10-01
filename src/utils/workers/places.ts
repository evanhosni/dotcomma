/** PLACE queries — which region/biome a point or grid cell is, where a cell's site stands, the
 *  sky's region weights (sky blend, address bar, fast travel). Main-thread rate, never per vertex. */

import type { PointXZ } from "../math/types";
import { domainConfig } from "./computeConfig";
import { unwarp, warp } from "./noise";
import type { DomainConfig, GridCell, SerializedBiome, SerializedRegion } from "./types";
import { biomeSiteAt, distanceToWall, getBiomeContext, getRegionGrid, nearestCell, rawBiomeSiteAt, regionSiteAt } from "./voronoi";
import { resolveHalf, sstep01 } from "./zoneBlend";

let regionWeights = new Float64Array(0);

export const initPlaces = (config: DomainConfig): void => {
  regionWeights = new Float64Array(config.regions.length);
};

export interface PlaceInfo {
  biomeId: number;
  regionId: number;
  /** Region-grid cell the (warped) point falls in, and the biome-grid cell — the two units an address names. */
  regionCell: GridCell;
  biomeCell: GridCell;
  /** Normalized cross-fade weights per region in config order — what the sky mixes. */
  regionWeights: { id: number; weight: number }[];
}

/** Which region / biome a world point is in, plus how much of each region the SKY
 *  should show there. Region weights use the regions' own blend widths (not the
 *  biomes'): the city's 2u feather must not snap the sky. */
export function getPlaceInfo(x: number, z: number): PlaceInfo {
  if (!domainConfig) throw new Error("vertexCompute not initialized");
  const warped = warp(x, z);
  const ctx = getBiomeContext(warped);
  const own = ctx.zone;
  const regions = domainConfig.regions;
  const halfOf = (r: SerializedRegion) => resolveHalf(r.blendWidth, domainConfig!.defaultBlendWidth);
  regionWeights.fill(0);
  regionWeights[own.regionIndex] = 1;
  for (const w of ctx.zoneWalls) {
    if (w.a.region === w.b.region) continue;
    const d = distanceToWall(warped.x, warped.z, [w]);
    const ai = w.a.regionIndex;
    const bi = w.b.regionIndex;
    const ha = halfOf(w.a.region);
    const hb = halfOf(w.b.region);
    if (w.a.region === own.region) {
      regionWeights[ai] = Math.min(regionWeights[ai], sstep01((d + hb) / (ha + hb)));
      regionWeights[bi] = Math.max(regionWeights[bi], sstep01((ha - d) / (ha + hb)));
    } else if (w.b.region === own.region) {
      regionWeights[bi] = Math.min(regionWeights[bi], sstep01((d + ha) / (ha + hb)));
      regionWeights[ai] = Math.max(regionWeights[ai], sstep01((hb - d) / (ha + hb)));
    } else {
      // A function of the wall alone (see accumulateWallFields' "outside both").
      regionWeights[ai] = Math.max(regionWeights[ai], sstep01((hb - d) / (ha + hb)));
      regionWeights[bi] = Math.max(regionWeights[bi], sstep01((ha - d) / (ha + hb)));
    }
  }
  let sum = 0;
  for (let i = 0; i < regions.length; i++) sum += regionWeights[i];
  const regionCell = nearestCell(warped, getRegionGrid(warped));
  return {
    biomeId: own.biome.id,
    regionId: own.region.id,
    regionCell: { ix: regionCell.ix, iz: regionCell.iz },
    biomeCell: { ix: ctx.cell.ix, iz: ctx.cell.iz },
    regionWeights: regions.map((r, i) => ({ id: r.id, weight: regionWeights[i] / sum })),
  };
}

/** The region a region-grid cell rolled — a pure function of the cell (and the seed),
 *  so an address resolves whether or not anyone has ever been there. */
export function getRegionOfCell(ix: number, iz: number): SerializedRegion {
  if (!domainConfig) throw new Error("vertexCompute not initialized");
  return regionSiteAt(ix, iz).region;
}

/** A region-grid cell's voronoi SITE in real world space (always inside the cell). */
export function getRegionCellSite(ix: number, iz: number): PointXZ {
  if (!domainConfig) throw new Error("vertexCompute not initialized");
  const s = regionSiteAt(ix, iz);
  return unwarp(s.x, s.z);
}

/** The zone (region + biome) a biome-grid cell rolled. */
export function getZoneOfBiomeCell(ix: number, iz: number): { region: SerializedRegion; biome: SerializedBiome } {
  if (!domainConfig) throw new Error("vertexCompute not initialized");
  const zone = biomeSiteAt(ix, iz).zone;
  return { region: zone.region, biome: zone.biome };
}

/** A biome-grid cell's voronoi SITE in real world space — where travel to that cell lands. */
export function getBiomeCellSite(ix: number, iz: number): PointXZ {
  if (!domainConfig) throw new Error("vertexCompute not initialized");
  const s = rawBiomeSiteAt(ix, iz);
  return unwarp(s.x, s.z);
}

/** The first cell on square rings outward from `from` (each ring in ix-then-iz order) that passes
 *  `test`; null within maxRing. */
const findCellInRings = (from: GridCell, maxRing: number, test: (ix: number, iz: number) => boolean): GridCell | null => {
  for (let r = 0; r <= maxRing; r++) {
    for (let ix = from.ix - r; ix <= from.ix + r; ix++) {
      for (let iz = from.iz - r; iz <= from.iz + r; iz++) {
        if (Math.abs(ix - from.ix) !== r && Math.abs(iz - from.iz) !== r) continue;
        if (test(ix, iz)) return { ix, iz };
      }
    }
  }
  return null;
};

/** Nearest region cell that rolled `regionId`. */
export const findRegionCell = (regionId: number, from: GridCell, maxRing = 64): GridCell | null =>
  findCellInRings(from, maxRing, (ix, iz) => getRegionOfCell(ix, iz).id === regionId);

/** Nearest biome cell that rolled `biomeId` — inside `regionId` when given. */
export const findBiomeCell = (biomeId: number, from: GridCell, regionId?: number, maxRing = 40): GridCell | null =>
  findCellInRings(from, maxRing, (ix, iz) => {
    const zone = getZoneOfBiomeCell(ix, iz);
    return zone.biome.id === biomeId && (regionId === undefined || zone.region.id === regionId);
  });
