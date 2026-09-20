import { DomainConfig } from "../../utils/workers/vertexCompute";
import { Region, TerrainParams } from "../types";

export type DomainId = "home" | "glitch-city";

/** What a committed <Domain> publishes for non-React code (accessors in utils.ts). */
export interface ActiveDomain {
  regions: Region[];
  params: TerrainParams;
  config: DomainConfig;
  riverTexture: string;
}
