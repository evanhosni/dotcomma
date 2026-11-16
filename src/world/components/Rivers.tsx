import type { ReactNode } from "react";
import { readWaterColors } from "../../utils/workers/water/material";
import { RIVERS, type RiversParams } from "../../utils/workers/water/rivers/params";
import type { WaterColorProps } from "../../utils/workers/water/types";
import { declareWaterBody, definedProps } from "./Water";

export interface RiversProps extends Omit<RiversParams, keyof WaterColorProps>, WaterColorProps {
  children?: ReactNode;
}

/** RIVERS where it is mounted. Rivers run on their OWN voronoi grid and cross every biome wall: a
 *  region says how often its ground is cut by them (`chance`, per river-grid edge; no <Rivers/> in a
 *  region = none), and a biome mounting its own overrides its region's prop by prop — an edge is kept at
 *  the chance of the biome under its midpoint, and a biome at chance 0 is DRY (no piece of any river is
 *  built in it; a stretch reaching it ends at its wall like any blocked one). How a river ENDS is the
 *  <Pond riverEnd> chance there (a miss ends it round). Its shape where it runs (`width`, `depth`, its
 *  walls) and the rules of where it may run and which gaps it crosses (the GAP RULES, judged by the biome
 *  under an edge's midpoint) resolve biome → region → <Water defaults={{ rivers }}> → RIVERS_DEFAULTS
 *  (rivers/params.ts); its water's colours fall back to its region's, then the <Water> base's. A body of
 *  water: its children are its PARTS. */
export const Rivers = declareWaterBody<RiversProps>({
  kind: RIVERS,
  within: ["region", "biome"],
  read: (node): RiversParams => {
    const { children: _parts, shallowColor: _s, deepColor: _d, deepDepth: _dd, ...shape } = node.props;
    return { ...definedProps(shape), ...readWaterColors(node.props) };
  },
});
