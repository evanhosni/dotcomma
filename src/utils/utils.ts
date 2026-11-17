import type { TravelRefetch } from "./types";
import { Biome, Region } from "../world/types";

/** A content mistake (a spec, a mount, a shader, a state machine) is loud where it is made: it throws
 *  outside production (dev and tests) and only logs in production, so a shipped build keeps running.
 *  Three-free: the server reports its own spec checks through it. */
export const reportContentError = (message: string): void => {
  if (process.env.NODE_ENV === "production") console.error(message);
  else throw new Error(message);
};

/**
 * The NEARBY SET of world points a system draws a fixed pool from (CityLights, the far cave mouths):
 * fetched around the camera again only after it has travelled, and the nearest N of it picked
 * without allocating. Three-free.
 */

export const createTravelRefetch = <T>(
  travel: number,
  fetch: (x: number, z: number) => Promise<T>,
  apply: (result: T, x: number, z: number) => void,
): TravelRefetch => {
  let fetchedAt: { x: number; z: number } | null = null;
  let fetching = false;
  let generation = 0;
  return {
    update(x, z) {
      if (fetching || (fetchedAt !== null && (x - fetchedAt.x) ** 2 + (z - fetchedAt.z) ** 2 <= travel * travel)) return;
      fetching = true;
      const mine = generation;
      fetch(x, z)
        .then((result) => {
          if (mine !== generation) return;
          apply(result, x, z);
          fetchedAt = { x, z };
        })
        .catch(() => undefined)
        .finally(() => {
          if (mine === generation) fetching = false;
        });
    },
    get fetchedAt() {
      return fetchedAt;
    },
    reset() {
      fetchedAt = null;
      fetching = false;
      generation++;
    },
  };
};

/** Fills `nearest` (and `nearestDistSq`, ascending) with the `nearest.length` items closest to
 *  (camX, camZ) by `x`/`z`; null past the item count. An insertion sort into a fixed array: no allocation. */
export const selectNearest = <T>(
  items: Iterable<T> | ReadonlyMap<unknown, T>,
  xOf: (item: T) => number,
  zOf: (item: T) => number,
  camX: number,
  camZ: number,
  nearest: (T | null)[],
  nearestDistSq: Float64Array,
): number => {
  const capacity = nearest.length;
  for (let i = 0; i < capacity; i++) nearest[i] = null;
  let count = 0;
  const visit = (p: T): void => {
    const dx = xOf(p) - camX;
    const dz = zOf(p) - camZ;
    const d = dx * dx + dz * dz;
    if (count < capacity) count++;
    else if (d >= nearestDistSq[capacity - 1]) return;
    let i = count - 1;
    while (i > 0 && nearestDistSq[i - 1] > d) {
      nearestDistSq[i] = nearestDistSq[i - 1];
      nearest[i] = nearest[i - 1];
      i--;
    }
    nearestDistSq[i] = d;
    nearest[i] = p;
  };
  if (items instanceof Map) items.forEach(visit);
  else for (const p of items as Iterable<T>) visit(p);
  return count;
};

/** Every biome of the regions, once each (a biome listed by two regions is one object), in region → biome order. */
export const getAllBiomes = (regions: Region[]): Biome[] => Array.from(new Set(regions.flatMap((region) => region.biomes)));

/** Phase-offsets an object's every-Nth-frame work so a spawn batch doesn't all fire on the same frame (CLAUDE.md Performance Notes). */
export const framePhaseFromCoords = (x: number, z: number, interval: number): number =>
  Math.abs(Math.floor(x * 7.13 + z * 3.71)) % interval;

/** A console-only handle on a live system (`window.__terrainLod`, `__entities`, `__dotcomma`).
 *  A no-op where there is no window — the SERVER bundles the client's content tree, and with it
 *  whatever these modules sit in. Returns its own remover. */
export const debugGlobal = (name: string, value: unknown): (() => void) => {
  if (typeof window === "undefined") return () => {};
  (window as unknown as Record<string, unknown>)[name] = value;
  return () => {
    delete (window as unknown as Record<string, unknown>)[name];
  };
};
