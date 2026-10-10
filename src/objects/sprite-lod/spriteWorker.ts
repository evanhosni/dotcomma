import { SPAWN_CHUNK_SIZE } from "../../utils/workers/constants";
import type { DomainConfig } from "../../utils/workers/vertexCompute";
import { createWorkerClient } from "../../utils/workers/workerClient";
import type { SerializedActorDescriptor } from "../actors/spawning/types";
import { chunkGap, spriteClock } from "./utils";
import type { SpriteChunkLook, SpriteChunkResult, SpriteKindSource } from "./types";

/**
 * SPRITE LOADING: every spawn chunk whose area comes within reach of the camera, nearest first, generated
 * on up to two spawn-worker threads of their own (the pool's thread keeps the near actors), each handed new
 * chunks the moment it goes idle. A request carries up to CHUNKS_PER_REQUEST chunks under a time budget;
 * what it did not finish goes out again against the camera of the moment. The numbers are measured
 * (building/DECISIONS.md).
 */

const MAX_GENERATORS = 2;
const generatorCount = (): number => Math.min(MAX_GENERATORS, Math.max(1, (navigator.hardwareConcurrency || 4) - 2));
const CHUNKS_PER_REQUEST = 12;
const REQUEST_BUDGET_MS = 120;
/** The worker client has no error path: an unanswered request would hold its thread forever. */
const REQUEST_TIMEOUT_MS = 20_000;
/** A chunk whose generation throws is tried this many times, then loaded empty until evicted. */
const GENERATION_ATTEMPTS = 2;
const EVICT_EVERY_FRAMES = 30;

export interface SpriteLoadingSource {
  config: DomainConfig;
  /** The pool's: placement spaces exactly as it does. */
  maxFootprint: number;
  /** Every actor kind: placement spaces sprite kinds against the rest too. */
  descriptors: SerializedActorDescriptor[];
  kinds: SpriteKindSource[];
  /** Chunks whose area comes within it load. */
  reach: number;
  /** Chunks entirely past it are dropped, here and in the threads. */
  dropDistance: number;
}

export interface LoadedSpriteChunk {
  minX: number;
  minZ: number;
  /** spriteClock() when it landed: its sprites' arrival fade. */
  born: number;
  looks: SpriteChunkLook[];
}

interface ChunkRef {
  key: number;
  cx: number;
  cz: number;
  minX: number;
  minZ: number;
}

/** Chunk indices within ±KEY_SPAN/2 (±262,000 km) key exactly into one float64. Numeric keys keep the
 *  per-frame candidate scan free of string building. */
const KEY_SPAN = 2 ** 21;
const keyOf = (cx: number, cz: number): number => (cx + KEY_SPAN / 2) * KEY_SPAN + (cz + KEY_SPAN / 2);
const protocolKeyOf = (ref: ChunkRef): string => `${ref.cx}_${ref.cz}`;

interface Generator {
  index: number;
  client: ReturnType<typeof createWorkerClient>;
  /** The request in flight, null when idle. */
  request: object | null;
}

let source: SpriteLoadingSource | null = null;
/** Bumped by every reset: an answer or a timeout from before it touches nothing. */
let epoch = 0;
const generators: Generator[] = [];
const loaded = new Map<number, LoadedSpriteChunk>();
const pending = new Set<number>();
/** Chunks whose generation threw, by key: attempts so far. */
const failures = new Map<number, { ref: ChunkRef; attempts: number }>();
let version = 0;
let focusX = 0;
let focusZ = 0;
let frame = 0;
/** Nothing left to ask for until the camera's chunk changes or a chunk comes back unloaded. */
let settled = false;

const createGenerator = (index: number): Generator => ({
  index,
  request: null,
  client: createWorkerClient({
    create: () => new Worker(new URL("../../utils/workers/spawn.worker.ts", import.meta.url), { type: "module" }),
    init: () => ({ config: source!.config, maxFootprint: source!.maxFootprint }),
    resultType: "SPRITES_RESULT",
  }),
});

// Chunk offsets from the camera's chunk, nearest first (dx, dz pairs): every chunk whose square comes within
// reach of the camera chunk's square, a superset for any camera position inside it (nextMissing filters exactly).
// They depend on the reach alone, so they are built once per source.
let offsets = new Int32Array(0);
let focusCX = NaN;
let focusCZ = NaN;

const offsetsWithin = (reach: number): Int32Array => {
  const span = Math.ceil(reach / SPAWN_CHUNK_SIZE) + 1;
  const ordered: { dx: number; dz: number; order: number }[] = [];
  for (let dx = -span; dx <= span; dx++) {
    for (let dz = -span; dz <= span; dz++) {
      const gap = SPAWN_CHUNK_SIZE * Math.hypot(Math.max(0, Math.abs(dx) - 1), Math.max(0, Math.abs(dz) - 1));
      if (gap <= reach) ordered.push({ dx, dz, order: dx * dx + dz * dz });
    }
  }
  ordered.sort((a, b) => a.order - b.order);
  return Int32Array.from(ordered.flatMap(({ dx, dz }) => [dx, dz]));
};

/** Calls visit(cx, cz, key) for each candidate chunk nearest first, until it returns false. */
const forEachCandidate = (visit: (cx: number, cz: number, key: number) => boolean): void => {
  for (let i = 0; i < offsets.length; i += 2) {
    const cx = focusCX + offsets[i];
    const cz = focusCZ + offsets[i + 1];
    if (!visit(cx, cz, keyOf(cx, cz))) return;
  }
};

const isMissing = (cx: number, cz: number, key: number, reach: number): boolean =>
  !loaded.has(key) && !pending.has(key) && chunkGap(focusX, focusZ, cx * SPAWN_CHUNK_SIZE, cz * SPAWN_CHUNK_SIZE) <= reach;

const nextMissing = (count: number, reach: number): ChunkRef[] => {
  const out: ChunkRef[] = [];
  forEachCandidate((cx, cz, key) => {
    if (isMissing(cx, cz, key, reach)) out.push({ key, cx, cz, minX: cx * SPAWN_CHUNK_SIZE, minZ: cz * SPAWN_CHUNK_SIZE });
    return out.length < count;
  });
  return out;
};

const accept = (result: SpriteChunkResult, ref: ChunkRef): void => {
  if (result.failed) {
    const attempts = (failures.get(ref.key)?.attempts ?? 0) + 1;
    if (attempts < GENERATION_ATTEMPTS) {
      failures.set(ref.key, { ref, attempts });
      return;
    }
  }
  failures.delete(ref.key);
  loaded.set(ref.key, { minX: ref.minX, minZ: ref.minZ, born: spriteClock(), looks: result.looks });
  version++;
};

const dispatch = (generator: Generator, refs: ChunkRef[], from: SpriteLoadingSource): void => {
  const request = {};
  const requestEpoch = epoch;
  generator.request = request;
  for (const ref of refs) pending.add(ref.key);
  const current = (): boolean => epoch === requestEpoch && generator.request === request;
  const finish = (): void => {
    generator.request = null;
    for (const ref of refs) pending.delete(ref.key);
    settled = false;
    pump();
  };

  const timeout = setTimeout(() => {
    if (!current()) return;
    console.error(`[sprite-lod] worker ${generator.index} did not answer in ${REQUEST_TIMEOUT_MS / 1000}s: restarting it`);
    generator.client.reset();
    finish();
  }, REQUEST_TIMEOUT_MS);

  generator.client
    .request<{ chunks: SpriteChunkResult[] }>({
      type: "GENERATE_SPRITES",
      chunkKeys: refs.map(protocolKeyOf),
      descriptors: from.descriptors,
      kinds: from.kinds,
      budgetMs: REQUEST_BUDGET_MS,
      forget: { x: focusX, z: focusZ, distance: from.dropDistance },
    })
    .then(({ chunks }) => {
      if (!current()) return;
      clearTimeout(timeout);
      // finally: the timeout is already cleared, so a throw here must not leave the thread marked busy.
      try {
        const byProtocolKey = new Map(refs.map((ref) => [protocolKeyOf(ref), ref]));
        for (const chunk of chunks) {
          const ref = byProtocolKey.get(chunk.key);
          if (ref) accept(chunk, ref);
        }
      } finally {
        finish();
      }
    });
};

/** Hands every idle thread its next chunks. */
const pump = (): void => {
  if (!source || settled) return;
  for (const generator of generators) {
    if (generator.request) continue;
    const refs = nextMissing(CHUNKS_PER_REQUEST, source.reach);
    if (refs.length === 0) {
      if (pending.size === 0) settled = true;
      return;
    }
    dispatch(generator, refs, source);
  }
};

const evict = (): void => {
  const drop = source!.dropDistance;
  loaded.forEach((chunk, key) => {
    if (chunkGap(focusX, focusZ, chunk.minX, chunk.minZ) <= drop) return;
    loaded.delete(key);
    version++;
  });
  failures.forEach(({ ref }, key) => {
    if (chunkGap(focusX, focusZ, ref.minX, ref.minZ) > drop) failures.delete(key);
  });
};

/** Terminates the threads and drops everything loaded or in flight (a domain switch, a re-init). */
export const resetSpriteWorkers = (): void => {
  epoch++;
  source = null;
  for (const generator of generators) {
    generator.client.reset();
    generator.request = null;
  }
  loaded.clear();
  pending.clear();
  failures.clear();
  offsets = new Int32Array(0);
  focusCX = NaN;
  focusCZ = NaN;
  settled = false;
  version++;
};

/** Threads start lazily on the first request; a source with no sprite kinds starts none. */
export const initSpriteWorkers = (next: SpriteLoadingSource): void => {
  resetSpriteWorkers();
  if (next.kinds.length === 0) return;
  source = next;
  offsets = offsetsWithin(next.reach);
  const count = generatorCount();
  while (generators.length < count) generators.push(createGenerator(generators.length));
};

/** Every frame, with the camera position. */
export const updateSpriteLoading = (x: number, z: number): void => {
  focusX = x;
  focusZ = z;
  if (!source) return;
  const cx = Math.floor(x / SPAWN_CHUNK_SIZE);
  const cz = Math.floor(z / SPAWN_CHUNK_SIZE);
  if (cx !== focusCX || cz !== focusCZ) {
    focusCX = cx;
    focusCZ = cz;
    settled = false;
  }
  if (++frame % EVICT_EVERY_FRAMES === 0) evict();
  pump();
};

export const loadedSpriteChunks = (): ReadonlyMap<number, LoadedSpriteChunk> => loaded;

/** Changes whenever the loaded set does. */
export const spriteChunksVersion = (): number => version;

export const spriteLoadingStats = () => {
  const reach = source?.reach ?? 0;
  let missing = 0;
  let nearestMissing = Infinity;
  if (source) {
    forEachCandidate((cx, cz, key) => {
      if (isMissing(cx, cz, key, reach)) {
        missing++;
        nearestMissing = Math.min(nearestMissing, chunkGap(focusX, focusZ, cx * SPAWN_CHUNK_SIZE, cz * SPAWN_CHUNK_SIZE));
      }
      return true;
    });
  }
  return {
    ready: generators.some((g) => g.client.isReady()),
    /** An idle thread's index, −1 when every one is busy (or none runs). */
    idleWorker: source ? generators.findIndex((g) => g.request === null) : -1,
    reach: Math.round(reach),
    chunks: loaded.size,
    pending: pending.size,
    missing,
    /** To the missing chunk's nearest edge; null when none is missing. */
    nearestMissing: Number.isFinite(nearestMissing) ? Math.round(nearestMissing) : null,
  };
};
