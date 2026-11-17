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
