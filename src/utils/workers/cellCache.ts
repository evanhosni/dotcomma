/** Maps iterate in insertion order (≈ proximity to the player), so this evicts
 *  the far half — never clear(): a flatten tile costs 30–70ms to rebuild, and a
 *  full clear floods the next queries. */
export const dropOldestHalf = <K, V>(map: Map<K, V>): void => {
  let remaining = map.size >> 1;
  for (const key of map.keys()) {
    if (remaining-- <= 0) break;
    map.delete(key);
  }
};

/** Values cached per integer grid cell in nested numeric maps (a key string per lookup ran per
 *  vertex). Over `maxEntries`, `makeRoom` drops the oldest half of the ROWS. Callers look up, make
 *  room, build and set — in that order, so an eviction never sees the entry being built. */
export class CellCache<T> {
  private readonly rows = new Map<number, Map<number, T>>();
  private count = 0;

  constructor(private readonly maxEntries: number) {}

  get(ix: number, iz: number): T | undefined {
    return this.rows.get(ix)?.get(iz);
  }

  makeRoom(): void {
    if (this.count <= this.maxEntries) return;
    let drop = this.rows.size >> 1;
    for (const [key, row] of this.rows) {
      if (drop-- <= 0) break;
      this.count -= row.size;
      this.rows.delete(key);
    }
  }

  set(ix: number, iz: number, value: T): void {
    let row = this.rows.get(ix);
    if (!row) this.rows.set(ix, (row = new Map()));
    row.set(iz, value);
    this.count++;
  }

  clear(): void {
    this.rows.clear();
    this.count = 0;
  }
}

const pointBits = new Float64Array(2);
const pointWords = new Int32Array(pointBits.buffer);
const EMPTY_SLOTS = new Float64Array(0);

/** A number per exact (x, z) point, DIRECT-MAPPED: a hash of the two doubles picks one slot, a new
 *  point overwrites it. For pure functions of a point asked again and again (a key string per lookup —
 *  two doubles printed in full — cost more than many of the lookups saved). `size` is a power of 2;
 *  the slots (24 bytes each) are allocated on the first set, so a worker that never asks pays nothing. */
export class PointCache {
  private xs = EMPTY_SLOTS;
  private zs = EMPTY_SLOTS;
  private values = EMPTY_SLOTS;
  private readonly mask: number;

  constructor(private readonly size: number) {
    this.mask = size - 1;
  }

  private slot(x: number, z: number): number {
    const b = pointBits;
    const w = pointWords;
    b[0] = x;
    b[1] = z;
    let h = Math.imul(w[0] ^ Math.imul(w[1], 0x27d4eb2d), 0x165667b1);
    h = Math.imul(h ^ w[2] ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ w[3] ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) & this.mask;
  }

  /** The value cached for exactly (x, z), or undefined. */
  get(x: number, z: number): number | undefined {
    if (this.xs === EMPTY_SLOTS) return undefined;
    const i = this.slot(x, z);
    return this.xs[i] === x && this.zs[i] === z ? this.values[i] : undefined;
  }

  set(x: number, z: number, value: number): void {
    if (this.xs === EMPTY_SLOTS) {
      this.xs = new Float64Array(this.size).fill(NaN);
      this.zs = new Float64Array(this.size).fill(NaN);
      this.values = new Float64Array(this.size);
    }
    const i = this.slot(x, z);
    this.xs[i] = x;
    this.zs[i] = z;
    this.values[i] = value;
  }

  clear(): void {
    this.xs = EMPTY_SLOTS;
    this.zs = EMPTY_SLOTS;
    this.values = EMPTY_SLOTS;
  }
}
