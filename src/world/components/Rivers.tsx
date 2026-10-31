import { declare } from "../content";

export interface RiversProps {
  /** Scales the chance each river-grid edge under this region carries a river. Default 1. */
  chance?: number;
}

/** RIVERS under the region it is mounted in. Rivers run on their OWN voronoi grid and cross every
 *  biome wall, so no biome can own one: a region says how densely its ground is cut by them, and a
 *  region with no <Rivers/> has none. Their shape (half-width, depth, bank) is the domain's
 *  <Terrain river>, since one river crosses many regions. */
export const Rivers = declare<RiversProps>({ kind: "rivers", within: "region" });
