import type { PointXZ } from "../../../../utils/math/types";
import type { GridCell, SerializedBiome, SerializedRegion } from "../../../../generation";

/** A parsed URL path: a region part and an optional biome part, each either a TYPE name
 *  (a region's / biome's `name`) or a word name. */
export interface Address {
  region: { type?: string; words?: string[] };
  biome?: { type?: string; words?: string[] };
}

export interface ResolvedAddress {
  regionCell: GridCell;
  region: SerializedRegion;
  biomeCell: GridCell;
  biome: SerializedBiome;
  /** Where travel lands: the biome cell's voronoi site, in real world space. */
  site: PointXZ;
  /** The canonical path for the address bar: region words / biome words. */
  path: string;
}
