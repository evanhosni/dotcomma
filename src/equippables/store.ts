import { STARTING_EQUIPPABLES } from "./spec";

/** The local player's equippables: what it carries (the wheel's choices), what is in its hands ("" none: the
 *  wheel's "empty-handed"), and whether the wheel is open (held Tab: menus/overlay/EquipWheelOverlay.tsx). */
let carried: readonly string[] = STARTING_EQUIPPABLES;
let equipped = "";
let wheelOpen = false;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((fn) => fn());

export const getCarried = (): readonly string[] => carried;
export const getEquipped = (): string => equipped;
export const isEquipWheelOpen = (): boolean => wheelOpen;

export const equip = (id: string): void => {
  if (id === equipped || (id !== "" && !carried.includes(id))) return;
  equipped = id;
  notify();
};

export const setEquipWheelOpen = (open: boolean): void => {
  if (open === wheelOpen) return;
  wheelOpen = open;
  notify();
};

/** A fresh host carries what every player starts with, in no hand. */
export const resetEquipment = (): void => {
  carried = STARTING_EQUIPPABLES;
  equipped = "";
  wheelOpen = false;
  notify();
};

export const subscribeEquipment = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
