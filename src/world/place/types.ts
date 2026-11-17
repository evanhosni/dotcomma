import type { PlaceInfo } from "../../objects/dressing/worker";

export interface PlayerPlace extends PlaceInfo {
  regionName: string;
  biomeName: string;
  /** generation/index.ts ("road", "snow", "water", …, else the biome's name); "tunnel" underground. */
  ground: string;
}
