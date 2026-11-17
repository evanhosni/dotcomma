import type { ColliderBody, ColliderPart } from "../../../../src/objects/dressing/types";
import type { TunnelSpaceChunk } from "../../../../src/generation/underground/field/TunnelSpace";
import type { UndergroundChunk } from "../../../../src/generation/underground/types";

/** A job's `step(deadline)` returns true when finished; one that can't finish in a
 *  slice (a terrain chunk is 9409 height samples) keeps its own cursor and returns false. */
export interface Job {
  key: string;
  step: (deadline: number) => boolean;
}

/** Called with the deadline each work slice until it returns the value. */
export type ChunkBuilder<T> = (deadline: number) => T | undefined;

/** An off-thread half of a build: resolves the chunk's data, after which only the (cheap) main-thread
 *  finish runs on the queue. A rejection falls back to the whole build on the queue. */
export interface ChunkFetch<D> {
  promise: Promise<D>;
  cancel(): void;
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

export interface ObstaclePoint extends ColliderBody {
  parts: ColliderPart[];
}

export type TunnelPart = TunnelSpaceChunk & Pick<UndergroundChunk, "colliders" | "entrances" | "doors">;

/** What the worker computes per chunk, by layer. */
export interface ChunkLayerData {
  terrain: Float32Array;
  dressing: ObstaclePoint[];
  tunnels: TunnelPart[];
}

export type ChunkLayer = keyof ChunkLayerData;

export type ChunkGeneratorRequest =
  | { t: "job"; id: number; layer: ChunkLayer; gx: number; gz: number }
  | { t: "height"; id: number; x: number; z: number }
  | { t: "surface"; id: number; x: number; z: number; feetY: number }
  | { t: "cancel"; id: number };

export type ChunkGeneratorReply = { id: number; data?: unknown; error?: string };

export interface PhysicsWorldOptions {
  /** URL of chunkGenerator.worker (.ts under tsx, .js in the bundle). */
  chunkGeneratorWorker?: URL;
}
