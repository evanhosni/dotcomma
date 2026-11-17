import type { Job } from "./types";

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
