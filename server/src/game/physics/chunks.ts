/**
 * Budgeted generation for the physics world.
 *
 * JobQueue: units of work that run inside `work(budgetMs)` each tick, each
 * `step(deadline)` returning true when finished — a job that can't finish in
 * one slice (a terrain chunk: 9409 height samples) keeps its own cursor and
 * returns false. The tick never stalls on generation.
 *
 * ChunkStore<T>: REFCOUNTED keyed resources (terrain heightfields, dressing
 * collider chunks) built by such jobs. `request` bumps the refcount and queues
 * the build on first use; `release` drops it and disposes at zero; `isReady`
 * says whether the build has landed. Nothing is ever built for the whole
 * world — only what something currently holds.
 */

export interface Job {
  key: string;
  step: (deadline: number) => boolean;
}

export class JobQueue {
  private readonly jobs: Job[] = [];
  private readonly keys = new Set<string>();
  /** Longest single job step seen (ms) — the number to watch for budget overruns. */
  maxStepMs = 0;

  enqueue(key: string, step: (deadline: number) => boolean): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.jobs.push({ key, step });
  }

  /** Run jobs until `budgetMs` is spent (always ≥ one step). Returns ms used. */
  work(budgetMs: number): number {
    if (this.jobs.length === 0) return 0;
    const t0 = performance.now();
    const deadline = t0 + budgetMs;
    while (this.jobs.length > 0) {
      const job = this.jobs[0];
      const s0 = performance.now();
      const done = job.step(deadline);
      const ms = performance.now() - s0;
      if (ms > this.maxStepMs) this.maxStepMs = ms;
      if (done) {
        this.jobs.shift();
        this.keys.delete(job.key);
      }
      if (performance.now() >= deadline) break;
    }
    return performance.now() - t0;
  }

  get length(): number {
    return this.jobs.length;
  }

  clear(): void {
    this.jobs.length = 0;
    this.keys.clear();
  }
}

/** A chunk's build: called with the deadline until it returns the value. */
export type ChunkBuilder<T> = (deadline: number) => T | undefined;

interface ChunkRecord<T> {
  refs: number;
  value: T | null;
}

export class ChunkStore<T> {
  private readonly chunks = new Map<string, ChunkRecord<T>>();

  constructor(
    private readonly queue: JobQueue,
    private readonly name: string,
    /** Start a build for chunk (gx, gz); the returned stepper is called each work slice. */
    private readonly begin: (gx: number, gz: number) => ChunkBuilder<T>,
    private readonly dispose: (value: T) => void,
  ) {}

  key(gx: number, gz: number): string {
    return `${this.name}:${gx},${gz}`;
  }

  /** Hold chunk (gx, gz); built on the queue if nobody holds it yet. */
  request(gx: number, gz: number): string {
    const key = this.key(gx, gz);
    const rec = this.chunks.get(key);
    if (rec) {
      rec.refs++;
      return key;
    }
    const fresh: ChunkRecord<T> = { refs: 1, value: null };
    this.chunks.set(key, fresh);
    const build = this.begin(gx, gz);
    this.queue.enqueue(key, (deadline) => {
      if (this.chunks.get(key) !== fresh) return true; // released while pending
      const value = build(deadline);
      if (value === undefined) return false;
      fresh.value = value;
      return true;
    });
    return key;
  }

  release(key: string): void {
    const rec = this.chunks.get(key);
    if (!rec || --rec.refs > 0) return;
    if (rec.value !== null) this.dispose(rec.value);
    this.chunks.delete(key);
  }

  isReady(key: string): boolean {
    return this.chunks.get(key)?.value != null;
  }

  has(gx: number, gz: number): boolean {
    return this.chunks.has(this.key(gx, gz));
  }

  get built(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.value !== null) n++;
    return n;
  }

  get pending(): number {
    return this.chunks.size - this.built;
  }

  clear(): void {
    this.chunks.clear();
  }
}

/** Chunk indices (grid `size`) a body at (x, z) needs: its own, plus the
 *  neighbor across any edge within `margin` (a 2×2 at a corner). */
export const chunkIndicesNear = (x: number, z: number, size: number, margin: number): [number, number][] => {
  const gx = Math.floor(x / size);
  const gz = Math.floor(z / size);
  const fx = x - gx * size;
  const fz = z - gz * size;
  const xs = [gx];
  if (fx < margin) xs.push(gx - 1);
  else if (size - fx < margin) xs.push(gx + 1);
  const zs = [gz];
  if (fz < margin) zs.push(gz - 1);
  else if (size - fz < margin) zs.push(gz + 1);
  const out: [number, number][] = [];
  for (const a of xs) for (const b of zs) out.push([a, b]);
  return out;
};
