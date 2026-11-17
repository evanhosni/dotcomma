import type { PlayerPlace } from "./types";

let current: PlayerPlace | null = null;
const listeners = new Set<(place: PlayerPlace | null) => void>();

/** null until the first poll of this domain answers. */
export const getPlace = (): PlayerPlace | null => current;

/** Called with every poll's answer (and null on a domain switch). Returns its remover. */
export const onPlaceChange = (fn: (place: PlayerPlace | null) => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const publish = (place: PlayerPlace | null): void => {
  current = place;
  listeners.forEach((fn) => fn(place));
};

/** Domain-switch teardown (world/domains/utils.ts). */
export const resetPlace = (): void => publish(null);
