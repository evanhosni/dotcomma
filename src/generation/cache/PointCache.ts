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
