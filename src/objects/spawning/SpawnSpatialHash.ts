import { SpawnPoint } from "./types";

/**
 * Grid-based spatial hash for O(1) spacing checks.
 * Cell size is set to 2.5× the max footprint so that
 * any spacing query only needs to inspect 9 cells.
 */
export class SpawnSpatialHash {
  private cellSize: number;
  private invCellSize: number;
  private cells = new Map<string, SpawnPoint[]>();

  constructor(maxFootprint: number) {
    this.cellSize = Math.max(maxFootprint * 2.5, 1);
    this.invCellSize = 1 / this.cellSize;
  }

  private key(cx: number, cz: number): string {
    return `${cx}_${cz}`;
  }

  insert(point: SpawnPoint): void {
    const cx = Math.floor(point.x * this.invCellSize);
    const cz = Math.floor(point.z * this.invCellSize);
    const k = this.key(cx, cz);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = [];
      this.cells.set(k, bucket);
    }
    bucket.push(point);
  }

  /**
   * Returns true if there is any existing point within `minDist`
   * of (x, z), considering only points whose descriptorId-specific
   * distances are met.
   */
  isTooClose(
    x: number,
    z: number,
    minDist: number,
    spacingOverrides?: Record<string, number>
  ): boolean {
    const minDistSq = minDist * minDist;
    const searchRadius = Math.max(minDist, spacingOverrides ? Math.max(...Object.values(spacingOverrides)) : 0);
    const cellSpan = Math.ceil(searchRadius * this.invCellSize);
    const cx = Math.floor(x * this.invCellSize);
    const cz = Math.floor(z * this.invCellSize);

    for (let dx = -cellSpan; dx <= cellSpan; dx++) {
      for (let dz = -cellSpan; dz <= cellSpan; dz++) {
        const bucket = this.cells.get(this.key(cx + dx, cz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const p = bucket[i];
          const ddx = x - p.x;
          const ddz = z - p.z;
          const distSq = ddx * ddx + ddz * ddz;

          // Check descriptor-specific override first
          const overrideDist = spacingOverrides?.[p.descriptorId];
          if (overrideDist !== undefined) {
            if (distSq < overrideDist * overrideDist) return true;
          } else if (distSq < minDistSq) {
            return true;
          }
        }
      }
    }
    return false;
  }

  clear(): void {
    this.cells.clear();
  }

  get size(): number {
    let count = 0;
    for (const bucket of Array.from(this.cells.values())) {
      count += bucket.length;
    }
    return count;
  }
}
