import { Worker } from "node:worker_threads";
import type { DomainId } from "../../../../src/net/protocol";
import type { ChunkFetch } from "./chunks.js";
import type { ObstaclePoint } from "./obstaclePoints.js";

/**
 * Main-thread side of chunkGenerator.worker.ts. Sampling a terrain chunk is 9409 height evaluations
 * (100–400ms cold) and a single sample crossing a cold bridge cell can take 100ms+, which the
 * tick's 8ms work budget could only slice by row — so generation ran at ≤ 8% duty and its longest
 * rows were the tick's worst spikes. The worker returns plain data; the Rapier bodies are still
 * made on the tick's thread by the budgeted queue. A dead worker (or a failed job) rejects, and
 * the ChunkStore then builds that chunk in place as before.
 *
 * It also answers single HEIGHT queries for the tick (an NPC's spawn ground, its backstop and stuck
 * checks): the worker sampled the chunks around every body, so its pipeline caches are warm there,
 * while the tick thread's own are cold — one cold computeVertexData measured 254–385ms on the tick.
 */

/** What the worker computes per chunk, by layer. */
export interface ChunkLayerData {
  terrain: Float32Array;
  dressing: ObstaclePoint[];
}

export type ChunkLayer = keyof ChunkLayerData;

export type ChunkGeneratorRequest =
  | { t: "job"; id: number; layer: ChunkLayer; gx: number; gz: number }
  | { t: "height"; id: number; x: number; z: number }
  | { t: "cancel"; id: number };

export type ChunkGeneratorReply = { id: number; data?: unknown; error?: string };

interface PendingJob {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
}

export class ChunkGenerator {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingJob>();
  private nextId = 1;
  private dead: Error | null = null;

  constructor(workerUrl: URL, domain: DomainId) {
    this.worker = new Worker(workerUrl, { workerData: { domain } });
    this.worker.unref();
    this.worker.on("message", (reply: ChunkGeneratorReply) => this.settle(reply));
    this.worker.on("error", (err) => this.die(err));
    this.worker.on("exit", (code) => this.die(new Error(`exit ${code}`)));
  }

  get inFlight(): number {
    return this.pending.size;
  }

  /** null once the worker is gone: the caller builds in place. */
  fetch<L extends ChunkLayer>(layer: L, gx: number, gz: number): ChunkFetch<ChunkLayerData[L]> | null {
    if (this.dead) return null;
    const id = this.nextId++;
    const promise = this.expect<ChunkLayerData[L]>(id);
    this.worker.postMessage({ t: "job", id, layer, gx, gz } satisfies ChunkGeneratorRequest);
    return {
      promise,
      cancel: () => {
        if (!this.pending.delete(id) || this.dead) return;
        this.worker.postMessage({ t: "cancel", id } satisfies ChunkGeneratorRequest);
      },
    };
  }

  /** The analytic ground height at (x, z), answered ahead of every queued chunk; null once the worker is gone. */
  height(x: number, z: number): Promise<number> | null {
    if (this.dead) return null;
    const id = this.nextId++;
    const promise = this.expect<number>(id);
    this.worker.postMessage({ t: "height", id, x, z } satisfies ChunkGeneratorRequest);
    return promise;
  }

  private expect<D>(id: number): Promise<D> {
    return new Promise<D>((resolve, reject) => this.pending.set(id, { resolve: resolve as (data: unknown) => void, reject }));
  }

  terminate(): Promise<number> {
    this.dead ??= new Error("terminated");
    this.rejectAll(this.dead);
    return this.worker.terminate();
  }

  private settle(reply: ChunkGeneratorReply): void {
    const job = this.pending.get(reply.id);
    if (!job) return; // cancelled
    this.pending.delete(reply.id);
    if (reply.error) {
      console.warn(`[physics] generation job failed, computing in place: ${reply.error}`);
      job.reject(new Error(reply.error));
    } else job.resolve(reply.data);
  }

  private die(err: Error): void {
    if (this.dead) return;
    this.dead = err;
    console.warn(`[physics] generation worker gone, building in place from now on: ${err.message}`);
    this.rejectAll(err);
  }

  private rejectAll(err: Error): void {
    for (const job of this.pending.values()) job.reject(err);
    this.pending.clear();
  }
}
