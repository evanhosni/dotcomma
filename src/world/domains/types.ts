import { DomainConfig } from "../../utils/workers/vertexCompute";
import { Region, TerrainParams } from "../types";

/** The switchable top level of the content hierarchy: DOMAIN → REGION →
 *  BIOME. One domain is mounted at a time (home, glitch-city); switching is
 *  client-side (see navigation.ts). */
export type DomainId = "home" | "glitch-city";

/** Everything the committed <Domain> tree publishes for non-React code —
 *  see utils.ts for the accessors. */
export interface ActiveDomain {
  regions: Region[];
  params: TerrainParams;
  config: DomainConfig;
  riverTexture: string;
}
