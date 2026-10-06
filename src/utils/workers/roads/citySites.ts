/**
 * City LIGHT SITES: one point per city-biome cell (CityLights).
 */

import { CITY_BIOME_ID } from "../../../world/constants";
import { domainConfig } from "../computeConfig";
import { computeVertexDataRaw } from "../flattenPads";
import { unwarp } from "../noise";
import { biomeSiteAt } from "../voronoi";

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
