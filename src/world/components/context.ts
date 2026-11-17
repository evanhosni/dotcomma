import { createContext } from "react";
import type { WaterBodyRef } from "./water/types";

/** Where a view is mounted in the content tree. A biome's own components read it so they never
 *  have to be told which biome they are in (<GrassField> spawns in the biome it is mounted in). */
export const RegionContext = createContext<{ regionId: number; name: string } | null>(null);
export const BiomeContext = createContext<{ biomeId: number; name: string } | null>(null);
/** The body of water a part is mounted in (its foliage, its particles). */
export const WaterBodyContext = createContext<WaterBodyRef | null>(null);
