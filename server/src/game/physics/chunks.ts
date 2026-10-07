/** A job's `step(deadline)` returns true when finished; one that can't finish in a
 *  slice (a terrain chunk is 9409 height samples) keeps its own cursor and returns false. */
export interface Job {
  key: string;
  step: (deadline: number) => boolean;
}

export class JobQueue {
  private readonly jobs: Job[] = [];
  private readonly keys = new Set<string>();
  /** The number to watch for budget overruns. */
  maxStepMs = 0;

  enqueue(key: string, step: (deadline: number) => boolean): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.jobs.push({ key, step });
  }

  /** Always runs ≥ one step. Returns ms used. */
  workFor(budgetMs: number): number {
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

/** Called with the deadline each work slice until it returns the value. */
export type ChunkBuilder<T> = (deadline: number) => T | undefined;

/** An off-thread half of a build: resolves the chunk's data, after which only the (cheap) main-thread
 *  finish runs on the queue. A rejection falls back to the whole build on the queue. */
export interface ChunkFetch<D> {
  promise: Promise<D>;
  cancel(): void;
}

interface ChunkRecord<T> {
  refs: number;
  value: T | null;
  cancelFetch: (() => void) | null;
}

export interface ChunkStoreOptions<T, D> {
  /** Key prefix, so several stores share one JobQueue. */
  name: string;
  /** Gets the fetched data when `fetch` resolved, else undefined (build everything in place). */
  builder: (gx: number, gz: number, fetched?: D) => ChunkBuilder<T>;
  dispose: (value: T) => void;
  /** The off-thread half, when there is one; returning null builds that chunk in place. */
  fetch?: ((gx: number, gz: number) => ChunkFetch<D> | null) | null;
}

/** REFCOUNTED keyed resources built by queued jobs — nothing is ever built for the
 *  whole world, only what something currently holds. */
export class ChunkStore<T, D = never> {
  private readonly chunks = new Map<string, ChunkRecord<T>>();

  constructor(
    private readonly queue: JobQueue,
    private readonly opts: ChunkStoreOptions<T, D>,
  ) {}

  private key(gx: number, gz: number): string {
    return `${this.opts.name}:${gx},${gz}`;
  }

  request(gx: number, gz: number): string {
    const key = this.key(gx, gz);
    const rec = this.chunks.get(key);
    if (rec) {
      rec.refs++;
      return key;
    }
    const fresh: ChunkRecord<T> = { refs: 1, value: null, cancelFetch: null };
    this.chunks.set(key, fresh);
    const f = this.opts.fetch?.(gx, gz) ?? null;
    if (!f) {
      this.enqueueBuild(key, this.opts.builder(gx, gz));
      return key;
    }
    fresh.cancelFetch = f.cancel;
    const settle = (data?: D) => {
      fresh.cancelFetch = null;
      if (this.chunks.get(key) === fresh) this.enqueueBuild(key, this.opts.builder(gx, gz, data));
    };
    f.promise.then(settle, () => settle());
    return key;
  }

  /** The job builds for whatever record holds the key WHEN IT RUNS: a chunk released while pending
   *  and requested again before its job ran is still served by that job (the queue dedupes by key,
   *  so the new record's own enqueue is a no-op — tying the job to the old record left the new one
   *  unbuilt forever and every body holding it frozen). */
  private enqueueBuild(key: string, build: ChunkBuilder<T>): void {
    this.queue.enqueue(key, (deadline) => {
      const rec = this.chunks.get(key);
      if (!rec || rec.value !== null) return true;
      const value = build(deadline);
      if (value === undefined) return false;
      rec.value = value;
      return true;
    });
  }

  release(key: string): void {
    const rec = this.chunks.get(key);
    if (!rec || --rec.refs > 0) return;
    if (rec.value !== null) this.opts.dispose(rec.value);
    rec.cancelFetch?.();
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

/** The body's own chunk plus the neighbor across any edge within `margin` (a 2×2 at a corner). */
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
