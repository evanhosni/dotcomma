/**
 * The NEARBY SET of world points a system draws a fixed pool from (CityLights, the far cave mouths):
 * fetched around the camera again only after it has travelled, and the nearest N of it picked
 * without allocating. Three-free.
 */

/** Fetches around the camera when it has moved more than `travel` from the last successful fetch (or
 *  never fetched), one fetch at a time; a failed fetch retries on the next update. */
export interface TravelRefetch {
  update(x: number, z: number): void;
  /** Where the last successful fetch was centered; null before the first. */
  readonly fetchedAt: { x: number; z: number } | null;
  /** Forgets the last fetch and drops the one in flight (a domain reset: its worker may never answer), so
   *  the next update fetches. */
  reset(): void;
}

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
