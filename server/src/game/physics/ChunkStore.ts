import { JobQueue } from "./JobQueue";
import type { ChunkStoreOptions, ChunkBuilder } from "./types";

interface ChunkRecord<T> {
  refs: number;
  value: T | null;
  cancelFetch: (() => void) | null;
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

  /** Every built chunk's value. */
  forEachBuilt(fn: (value: T) => void): void {
    for (const c of this.chunks.values()) if (c.value !== null) fn(c.value);
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
