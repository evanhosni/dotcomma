import { CITY_REGION } from "./city/spec";
import { DESERT_REGION } from "./desert/spec";
import { OCEAN_REGION } from "./ocean/spec";
import { SNOW_REGION } from "./snow/spec";

/** THE overworld region list, in VORONOI order (the region roll is `floor(u × count)` over it):
 *  domain.tsx renders from it, config.ts (the server's copy) is built from it, and the CRT's
 *  address pages list it. Three-free. Appending a region re-rolls every region cell — every
 *  address moves (CLAUDE.md "Addresses"). */
export const OVERWORLD_REGIONS = [CITY_REGION, DESERT_REGION, SNOW_REGION, OCEAN_REGION];
