import { VFX_GROUPS } from "./enums";

/** The distance curve: no growth inside `start` (u); `size` (u) of grid 1km past it; steeper with `power`. */
export interface QuantizationGrowth {
  start: number;
  size: number;
  power: number;
}

export type VfxGroup = (typeof VFX_GROUPS)[number];

export interface VfxKnob {
  group: VfxGroup;
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (value: number) => void;
}
