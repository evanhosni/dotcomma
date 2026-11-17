import type { RockPoint } from "../../../rocks/types";

export interface WaterfallBoulder {
  rock: RockPoint;
  /** Its piece's fall, and the fall's downhill direction (world). */
  grade: number;
  dirX: number;
  dirZ: number;
}
