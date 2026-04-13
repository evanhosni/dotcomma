import { INDOOR_Y_OFFSET } from "./types";

const INDOOR_Y_SPACING = 200;
const freeSlots: number[] = [];
let nextSlot = 0;

export const allocateIndoorSlot = (): number => {
  if (freeSlots.length > 0) return freeSlots.pop()!;
  return nextSlot++;
};

export const releaseIndoorSlot = (slot: number): void => {
  freeSlots.push(slot);
};

export const getIndoorY = (slot: number): number => {
  return INDOOR_Y_OFFSET + slot * INDOOR_Y_SPACING;
};
