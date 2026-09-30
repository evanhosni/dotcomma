import type { PointXZ } from "../../utils/math/types";
import { LOD5_CHUNK_SIZE } from "./lodConfig";

/**
 * LOD SWAPS AS CROSS-FADES (terrain/README.md, "LOD swaps cross-fade"). When the quadtree replaces
 * chunks — one coarse chunk by its finer children, children by their parent, LOD1 by LOD2 — the old
 * and new chunks are drawn TOGETHER for LOD_FADE_SECONDS with a complementary screen-door dither: a
 * drawn chunk takes the pixels whose screen-door threshold h (world/shaders/lodFade.ts) lies in its
 * range [fadeLo, fadeHi). The new chunks of a swap hold [0, p) and the old ones [p, FADE_OPAQUE_HI)
 * of ONE progress p, so at every point of the ground each pixel belongs to exactly one of them:
 * never a hole, never a doubled surface, no sorting.
 *
 * Invariants (lodSwaps.test.ts checks them every frame of simulated walks):
 * - Every 420u cell is covered by drawn chunks whose ranges PARTITION [0, 1), or by none at all
 *   (land never shown yet); once covered it stays covered while inside the render disc.
 * - A swap starts only when its old chunks are all opaque (not fading) and their replacements all
 *   built; its old and new chunks cover exactly the same area (else the swap is instant, as it was
 *   before fades existed). Transitions never chain: a fading chunk waits until its fade ends.
 * - A fade whose old chunk becomes desired again runs BACKWARDS and ends with the new chunks hidden.
 */

/** Cross-fade time of one swap. */
export const LOD_FADE_SECONDS = 0.35;
/** An opaque chunk's range is [0, 2): past any threshold, 1.0 included. */
export const FADE_OPAQUE_HI = 2;

export interface SwapChunk {
  key: string;
  /** World-space center. */
  offset: PointXZ;
  lod: { chunkSize: number };
  built: boolean;
  drawn: boolean;
  /** The swap this chunk is fading in or out of; null = opaque when drawn. */
  transition: LodTransition<SwapChunk> | null;
  fadeLo: number;
  fadeHi: number;
}

export interface LodTransition<C extends SwapChunk> {
  /** 0 → only the old chunks show, 1 → only the new ones. */
  p: number;
  olds: C[];
  news: C[];
}

export interface SwapHooks<C extends SwapChunk> {
  isDesired(key: string): boolean;
  /** Frees the chunk (mesh, water, collider) and drops it from the chunk map. */
  destroy(chunk: C): void;
  /** `drawn`, `transition` or the range changed in a way the renderer must reflect (visibility, material). */
  redraw(chunk: C): void;
}

const overlaps = (a: SwapChunk, b: SwapChunk): boolean => {
  const aHalf = a.lod.chunkSize / 2;
  const bHalf = b.lod.chunkSize / 2;
  return (
    a.offset.x + aHalf > b.offset.x - bHalf &&
    a.offset.x - aHalf < b.offset.x + bHalf &&
    a.offset.z + aHalf > b.offset.z - bHalf &&
    a.offset.z - aHalf < b.offset.z + bHalf
  );
};

// Tile = the largest chunk size, so any chunk spans at most 2×2 tiles. Scanning the whole set per
// overlap query was O(chunks × queue), which grows into the hundreds on both sides when the player
// outruns generation.
const INDEX_TILE = LOD5_CHUNK_SIZE;

/** Coarse spatial index over chunks. A chunk may sit in several buckets: forEachOverlap can repeat one. */
export class ChunkIndex<C extends SwapChunk> {
  private tiles = new Map<number, Map<number, C[]>>();
  private count = 0;

  clear(): void {
    if (this.count === 0) return;
    this.tiles.clear();
    this.count = 0;
  }

  add(chunk: C): void {
    this.visitTiles(chunk, (col, tz) => {
      const bucket = col.get(tz);
      if (bucket) bucket.push(chunk);
      else col.set(tz, [chunk]);
    }, true);
    this.count++;
  }

  overlapsAny(chunk: SwapChunk): boolean {
    if (this.count === 0) return false;
    let hit = false;
    this.forEachOverlap(chunk, () => {
      hit = true;
    });
    return hit;
  }

  forEachOverlap(chunk: SwapChunk, fn: (other: C) => void): void {
    if (this.count === 0) return;
    this.visitTiles(chunk, (col, tz) => {
      const bucket = col.get(tz);
      if (!bucket) return;
      for (let i = 0; i < bucket.length; i++) {
        const other = bucket[i];
        if (other !== chunk && overlaps(chunk, other)) fn(other);
      }
    }, false);
  }

  private visitTiles(chunk: SwapChunk, fn: (col: Map<number, C[]>, tz: number) => void, create: boolean): void {
    const half = chunk.lod.chunkSize / 2;
    const tx1 = Math.floor((chunk.offset.x + half) / INDEX_TILE);
    const tz0 = Math.floor((chunk.offset.z - half) / INDEX_TILE);
    const tz1 = Math.floor((chunk.offset.z + half) / INDEX_TILE);
    for (let tx = Math.floor((chunk.offset.x - half) / INDEX_TILE); tx <= tx1; tx++) {
      let col = this.tiles.get(tx);
      if (!col) {
        if (!create) continue;
        col = new Map();
        this.tiles.set(tx, col);
      }
      for (let tz = tz0; tz <= tz1; tz++) fn(col, tz);
    }
  }
}

const setOpaque = (c: SwapChunk): void => {
  c.transition = null;
  c.fadeLo = 0;
  c.fadeHi = FADE_OPAQUE_HI;
};

const areaOf = (chunks: SwapChunk[]): number => {
  let a = 0;
  for (const c of chunks) a += c.lod.chunkSize * c.lod.chunkSize;
  return a;
};

/** The chunk-set bookkeeping between "these chunks are desired" and "these meshes are drawn". */
export class LodSwapper<C extends SwapChunk> {
  /** Cross-fade duration; 0 swaps in one frame. */
  fadeSeconds = LOD_FADE_SECONDS;
  readonly transitions = new Set<LodTransition<C>>();
  /** Drawn chunks that are no longer desired. */
  readonly stale = new Set<C>();
  /** A fade ended (or a pass changed something) since the last processSwaps: another pass must run. */
  private passDue = false;

  private pendingIndex = new ChunkIndex<C>();
  private drawnIndex = new ChunkIndex<C>();
  private hiddenIndex = new ChunkIndex<C>();
  private hidden: C[] = [];
  private seen = new Set<C>();
  private stack: C[] = [];
  private undrawn: C[] = [];

  /** While true the renderer must keep running its update pass (steady-state early-out off). */
  get busy(): boolean {
    return this.passDue || this.transitions.size > 0;
  }

  reset(): void {
    this.transitions.clear();
    this.stale.clear();
    this.passDue = false;
    this.pendingIndex.clear();
    this.drawnIndex.clear();
    this.hiddenIndex.clear();
    this.hidden.length = 0;
    this.seen.clear();
    this.stack.length = 0;
    this.undrawn.length = 0;
  }

  /** Drawn undesired chunks become stale (replaced later, by processSwaps). Undrawn undesired chunks
   *  are dropped, except under a stale chunk: those are COVER and wait until it is gone. */
  prune(chunks: Iterable<C>, isDesired: (key: string) => boolean, building: C | null, destroy: (chunk: C) => void): void {
    const cover = this.drawnIndex;
    cover.clear();
    const undrawn = this.undrawn;
    undrawn.length = 0;
    for (const c of chunks) {
      if (isDesired(c.key)) continue;
      if (c.drawn) {
        this.stale.add(c);
        cover.add(c);
      } else if (c !== building) undrawn.push(c);
    }
    for (const c of undrawn) if (!cover.overlapsAny(c)) destroy(c);
    undrawn.length = 0;
  }

  /** Starts every swap that is ready; shows built chunks that replace nothing. Must run even with no
   *  stale chunks — it is what makes freshly built chunks drawn at all. */
  processSwaps(chunks: Iterable<C>, hooks: SwapHooks<C>): void {
    const { isDesired } = hooks;
    this.passDue = false;
    const pending = this.pendingIndex;
    const drawn = this.drawnIndex;
    const hiddenIndex = this.hiddenIndex;
    const hidden = this.hidden;
    pending.clear();
    drawn.clear();
    hiddenIndex.clear();
    hidden.length = 0;
    for (const c of chunks) {
      if (!c.built) pending.add(c);
      else if (c.drawn) drawn.add(c);
      else if (isDesired(c.key)) {
        hiddenIndex.add(c);
        hidden.push(c);
      }
    }
    for (const o of this.stale) if (!o.drawn || isDesired(o.key)) this.stale.delete(o);

    // One swap = one connected component of the overlap graph between drawn and hidden-desired
    // chunks. The quadtree nests, so a component has ONE outermost rect: either one old chunk and
    // the new ones inside it, or one new chunk and the old ones inside it.
    const seen = this.seen;
    const stack = this.stack;
    seen.clear();
    const visit = (n: C) => {
      if (seen.has(n)) return;
      seen.add(n);
      stack.push(n);
    };
    for (const start of this.stale) {
      if (seen.has(start)) continue;
      const olds: C[] = [];
      const news: C[] = [];
      let ready = true;
      stack.length = 0;
      stack.push(start);
      seen.add(start);
      while (stack.length > 0) {
        const c = stack.pop()!;
        if (c.drawn) {
          olds.push(c);
          if (c.transition !== null || !this.stale.has(c) || pending.overlapsAny(c)) ready = false;
          hiddenIndex.forEachOverlap(c, visit);
        } else {
          news.push(c);
          drawn.forEachOverlap(c, visit);
        }
      }
      if (!ready) continue;
      this.passDue = true;
      if (news.length > 0 && areaOf(olds) === areaOf(news)) {
        this.start(olds, news, hooks);
      } else {
        // Nothing to fade against over part of the area: swap at once. No replacement at all
        // happens only past the render disc.
        for (const o of olds) this.drop(o, hooks);
        for (const n of news) this.show(n, hooks);
      }
    }

    for (const n of hidden) {
      if (seen.has(n) || n.drawn) continue;
      if (drawn.overlapsAny(n)) continue;
      this.show(n, hooks);
      this.passDue = true;
    }
  }

  /** Advances every fade by `dt` seconds and finishes those that reached an end. */
  tick(dt: number, hooks: SwapHooks<C>): void {
    if (this.transitions.size === 0) return;
    const step = this.fadeSeconds > 0 ? dt / this.fadeSeconds : Infinity;
    for (const t of this.transitions) {
      const back = t.olds.some((o) => hooks.isDesired(o.key));
      t.p = Math.min(1, Math.max(0, t.p + (back ? -step : step)));
      if (!back && t.p >= 1) this.finish(t, hooks);
      else if (back && t.p <= 0) this.revert(t, hooks);
      else {
        for (const c of t.news) c.fadeHi = t.p;
        for (const c of t.olds) c.fadeLo = t.p;
      }
    }
  }

  private start(olds: C[], news: C[], hooks: SwapHooks<C>): void {
    const t: LodTransition<C> = { p: 0, olds, news };
    this.transitions.add(t);
    for (const o of olds) {
      o.transition = t as LodTransition<SwapChunk>;
      o.fadeLo = 0;
      o.fadeHi = FADE_OPAQUE_HI;
      hooks.redraw(o);
    }
    for (const n of news) {
      n.transition = t as LodTransition<SwapChunk>;
      n.drawn = true;
      n.fadeLo = 0;
      n.fadeHi = 0;
      hooks.redraw(n);
    }
  }

  private finish(t: LodTransition<C>, hooks: SwapHooks<C>): void {
    this.transitions.delete(t);
    this.passDue = true;
    for (const o of t.olds) {
      o.transition = null;
      this.drop(o, hooks);
    }
    for (const n of t.news) {
      setOpaque(n);
      hooks.redraw(n);
    }
  }

  private revert(t: LodTransition<C>, hooks: SwapHooks<C>): void {
    this.transitions.delete(t);
    this.passDue = true;
    for (const o of t.olds) {
      setOpaque(o);
      if (hooks.isDesired(o.key)) this.stale.delete(o);
      hooks.redraw(o);
    }
    for (const n of t.news) {
      setOpaque(n);
      n.drawn = false;
      this.stale.delete(n);
      hooks.redraw(n);
    }
  }

  private show(n: C, hooks: SwapHooks<C>): void {
    setOpaque(n);
    n.drawn = true;
    hooks.redraw(n);
  }

  private drop(o: C, hooks: SwapHooks<C>): void {
    this.stale.delete(o);
    hooks.destroy(o);
  }
}
