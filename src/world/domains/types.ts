import { DomainConfig } from "../../generation";
import type { AnyActorDescriptor } from "../../objects/actors/spawning/types";
import type { SkyboxRecord } from "../sky/types";
import { Region, TerrainParams } from "../types";

/** "overworld" is THE game — one infinite map of regions,
 *  addressed by URL (world/domains/overworld/address/index.ts); "404" is where every other path lands.
 *  Defined once, with the wire protocol. */
export type { DomainId } from "../../net/protocol/types";

/** What a committed <Domain> publishes for non-React code (accessors in utils.ts). */
export interface ActiveDomain {
  /** Voronoi (= JSX) order. */
  regions: Region[];
  params: TerrainParams;
  config: DomainConfig;
  riverTexture: string;
  /** Domain / region / biome skies, as the tree mounts them (world/sky/). */
  skyboxes: SkyboxRecord[];
  /** One per kind, spawning in the union of the biomes that mount it. */
  actors: AnyActorDescriptor[];
}
