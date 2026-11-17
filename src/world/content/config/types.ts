import type { ActorMount } from "../../../objects/actors/spec";
import type { BiomeNoiseConfig, TerrainNoiseParams } from "../../../generation/types";

export interface BiomeIdentity {
  id: number;
  name: string;
  joinable?: boolean;
  /** Its share of its region's biome roll against its siblings' (default 1; all 1 = the plain
   *  floor(roll × count)). Changing one MOVES THE MAP. */
  weight?: number;
  blendWidth?: number;
  heightBlendWidth?: number;
  /** The smallest pond radius here (real units); unset = its region's, then the domain's. */
  pondMinRadius?: number;
  /** How far land here rises above its water, and over how far from it (real units; utils/workers/water/valleys);
   *  unset = its region's, then the domain's. */
  additionalHeight?: number;
  additionalHeightBlend?: number;
}

export interface RegionIdentity {
  id: number;
  name: string;
  blendWidth?: number;
  heightBlendWidth?: number;
  pondMinRadius?: number;
  additionalHeight?: number;
  additionalHeightBlend?: number;
}

export interface NoiseProps extends Partial<Pick<BiomeNoiseConfig, "absNeg" | "scale" | "offset">> {
  params: TerrainNoiseParams;
}

/** One <Actor> mounted in a biome. `feature` is the dotted path of the feature that PLACES it
 *  (a <Sewers><Rooms><Actor/>> stands one in each room), empty for a biome's own density placement;
 *  `id` is the descriptor id, which is also the entity kind on the wire. */
export interface ActorPlacement {
  id: string;
  mount: ActorMount;
  feature: string;
}
