import type { BiomeSpec } from "../../../../../../types";

/** A lake: the water stands at a LEVEL (the region base at the cell's site, blended across
 *  neighboring water cells — lakes.ts), and the terrain is defined relative to it: the shore
 *  SHORE_RISE above it at the wall, descending over `blendWidth` to `water.depth` below it.
 *  A river reaching a lake runs on into the basin and ends there in a pond (the mouth). */
export const LAKE_BIOME: BiomeSpec = {
  id: 8,
  name: "lake",
  joinable: true,
  blendWidth: 90,
  prohibitRoads: true,
  water: { depth: 26 },
};
