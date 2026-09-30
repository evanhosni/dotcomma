import { DomainConfig } from "../../utils/workers/vertexCompute";
import { Region, TerrainParams } from "../types";

/** "home" is the landing page; "overworld" is THE game — one infinite map of regions,
 *  addressed by URL (world/domains/overworld/address.ts). Defined once, with the wire protocol. */
export type { DomainId } from "../../net/protocol";

/** What a committed <Domain> publishes for non-React code (accessors in utils.ts). */
export interface ActiveDomain {
  /** Voronoi (= JSX) order. */
  regions: Region[];
  params: TerrainParams;
  config: DomainConfig;
  riverTexture: string;
}
