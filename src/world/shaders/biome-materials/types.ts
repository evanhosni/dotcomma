import { Biome } from "../../types";

export interface BiomeMixInput {
  biomes: Biome[];
  slotsWithMaterial: number[];
  /** The slots that draw: their own material, or else their region's base. */
  drawnSlots: number[];
  baseFunctionOf: (string | null)[];
  slotRegions?: number[];
  slotHalves?: number[];
}
