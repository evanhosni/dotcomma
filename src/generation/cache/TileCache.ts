import { CellCache } from "./CellCache";

/** A list per square TILE of `tileSize`, the LAST tile remembered (vertex after vertex asks for the same
 *  tile); a cold tile is built once by `build` and kept (CellCache, the oldest half dropped past
 *  `maxEntries`). */
export class TileCache<T> {
  private readonly tiles: CellCache<T>;
  private lastX = NaN;
  private lastZ = NaN;
  private last: T | null = null;

  constructor(
    private readonly tileSize: number,
    maxEntries: number,
    private readonly build: (tx: number, tz: number) => T,
  ) {
    this.tiles = new CellCache<T>(maxEntries);
  }

  at(x: number, z: number): T {
    const tx = Math.floor(x / this.tileSize);
    const tz = Math.floor(z / this.tileSize);
    if (tx === this.lastX && tz === this.lastZ) return this.last!;
    let value = this.tiles.get(tx, tz);
    if (value === undefined) {
      value = this.build(tx, tz);
      this.tiles.makeRoom();
      this.tiles.set(tx, tz, value);
    }
    this.lastX = tx;
    this.lastZ = tz;
    this.last = value;
    return value;
  }

  clear(): void {
    this.tiles.clear();
    this.lastX = NaN;
    this.lastZ = NaN;
    this.last = null;
  }
}
