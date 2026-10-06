import * as RAPIER from "@dimforge/rapier3d-compat";
import type { DomainId } from "../../../../src/net/protocol";
import { GRAVITY } from "../../../../src/physics/characterMovement";
import { computeVertexData, initCompute } from "../../../../src/utils/workers/vertexCompute";
import { DOMAIN_CONFIGS } from "../../../../src/world/domains/configs";
import { TICK_SECONDS } from "../tick.js";
import { ChunkGenerator } from "./chunkGenerator.js";
import { ChunkStore, JobQueue, type ChunkBuilder } from "./chunks.js";
import { enumerateObstacles, type ObstaclePoint } from "./obstaclePoints.js";
import { createObstacleBodies } from "./obstacles.js";
import { chunkCenter, chunkIndex, sampleChunkRow, TERRAIN_CHUNK_SIZE, TERRAIN_ROWS, TERRAIN_SEGMENTS } from "./terrain.js";

/**
 * Headless Rapier (the client's package, bundled from the root install) stepped at the
 * entity tick: the world, the budgeted JobQueue, and two refcounted ChunkStores —
 * TERRAIN heightfields (the client's LOD1 recipe) and DRESSING obstacles. Whoever needs
 * a chunk holds it; nothing is built world-wide. The height pipeline is initialized from
 * the physics domain's shared DomainConfig (src/world/domains/configs.ts); walkers in
 * other domains run their machine but stay put. With a `chunkGeneratorWorker` (the server
 * boot passes one) heights and dressing points are computed off-thread (chunkGenerator.ts)
 * and the queue only makes their bodies; without one (tests, tools) everything is built in
 * place under workFor(), terrain row by row across ticks.
 */

export interface PhysicsWorldOptions {
  /** URL of chunkGenerator.worker (.ts under tsx, .js in the bundle). */
  chunkGeneratorWorker?: URL;
}

export const PHYSICS_DOMAIN: DomainId = "overworld";
export const DEFAULT_WORK_BUDGET_MS = 8;

let rapierReady: Promise<void> | null = null;
/** The compat build embeds the WASM — no flags, no fetch. */
const initRapier = (): Promise<void> => (rapierReady ??= RAPIER.init());

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly jobs = new JobQueue();
  readonly terrain: ChunkStore<RAPIER.RigidBody, Float32Array>;
  readonly dressing: ChunkStore<RAPIER.RigidBody[], ObstaclePoint[]>;
  private readonly generator: ChunkGenerator | null;
  private stepMs = 0;
  private maxStepMs = 0;
  private workMs = 0;
  private maxWorkMs = 0;
  private steps = 0;
  private queriesDirty = false;

  private constructor(world: RAPIER.World, generator: ChunkGenerator | null) {
    this.world = world;
    this.generator = generator;
    this.terrain = new ChunkStore(this.jobs, {
      name: "terrain",
      builder: (gx, gz, heights) => this.terrainBuilder(gx, gz, heights),
      dispose: (body) => this.removeBody(body),
      fetch: generator && ((gx, gz) => generator.fetch("terrain", gx, gz)),
    });
    this.dressing = new ChunkStore(this.jobs, {
      name: "dressing",
      builder: (gx, gz, points) => () => createObstacleBodies(this, points ?? enumerateObstacles(gx, gz)),
      dispose: (bodies) => bodies.forEach((b) => this.removeBody(b)),
      fetch: generator && ((gx, gz) => generator.fetch("dressing", gx, gz)),
    });
  }

  static async create(domain: DomainId = PHYSICS_DOMAIN, opts: PhysicsWorldOptions = {}): Promise<PhysicsWorld> {
    const config = DOMAIN_CONFIGS[domain];
    if (!config) throw new Error(`no shared domain config for "${domain}" (src/world/domains/configs.ts)`);
    await initRapier();
    initCompute(config);
    // Kinematic bodies ignore world gravity (the shared resolver applies GRAVITY itself); set for any future dynamic body.
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    world.timestep = TICK_SECONDS;
    const generator = opts.chunkGeneratorWorker ? new ChunkGenerator(opts.chunkGeneratorWorker, domain) : null;
    return new PhysicsWorld(world, generator);
  }

  workFor(budgetMs = DEFAULT_WORK_BUDGET_MS): number {
    const ms = this.jobs.workFor(budgetMs);
    if (ms > 0) this.queriesDirty = true;
    this.workMs = ms;
    if (ms > this.maxWorkMs) this.maxWorkMs = ms;
    return ms;
  }

  /** The analytic ground height at (x, z), for a body on the tick. With the generation worker it is
   *  answered there, LATER (a body asks before it needs the answer); without one, or once it is gone,
   *  `answer` runs in place, synchronously when there never was a worker. */
  heightAt(x: number, z: number, answer: (height: number) => void): void {
    const query = this.generator?.height(x, z);
    if (!query) {
      answer(computeVertexData(x, z).height);
      return;
    }
    query.then(answer, () => answer(computeVertexData(x, z).height));
  }

  /** Rapier only rebuilds its query structure inside step(), so a body stepped against
   *  a chunk built THIS tick sweeps straight through it (a beeble fell 1u
   *  into a just-built heightfield and sat wedged). Call after generation, before moving. */
  ensureQueries(): void {
    if (!this.queriesDirty) return;
    this.world.updateSceneQueries();
    this.queriesDirty = false;
  }

  step(): number {
    const t0 = performance.now();
    this.world.step();
    this.queriesDirty = false;
    this.steps++;
    this.stepMs = performance.now() - t0;
    if (this.stepMs > this.maxStepMs) this.maxStepMs = this.stepMs;
    return this.stepMs;
  }

  /** Fetched heights only need their body; in place, the chunk is sampled row by row until each slice's deadline. */
  private terrainBuilder(gx: number, gz: number, fetched?: Float32Array): ChunkBuilder<RAPIER.RigidBody> {
    if (fetched) return () => this.createHeightfield(gx, gz, fetched);
    const heights = new Float32Array(TERRAIN_ROWS * TERRAIN_ROWS);
    let row = 0;
    return (deadline) => {
      while (row < TERRAIN_ROWS) {
        sampleChunkRow(gx, gz, row++, heights);
        if (performance.now() >= deadline) break;
      }
      return row < TERRAIN_ROWS ? undefined : this.createHeightfield(gx, gz, heights);
    };
  }

  private createHeightfield(gx: number, gz: number, heights: Float32Array): RAPIER.RigidBody {
    const desc = RAPIER.ColliderDesc.heightfield(TERRAIN_SEGMENTS, TERRAIN_SEGMENTS, heights, { x: TERRAIN_CHUNK_SIZE, y: 1, z: TERRAIN_CHUNK_SIZE });
    // Desc before body: a failure can't leave an empty body.
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(chunkCenter(gx), 0, chunkCenter(gz)));
    this.world.createCollider(desc, body);
    this.queriesDirty = true;
    return body;
  }

  createCapsule(x: number, feetY: number, z: number, radius: number, height: number): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const halfHeight = height / 2;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, feetY + halfHeight, z));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight - radius, radius), body);
    this.queriesDirty = true;
    return { body, collider };
  }

  removeBody(body: RAPIER.RigidBody): void {
    this.world.removeRigidBody(body);
    this.queriesDirty = true;
  }

  /** For code that creates colliders through `world` directly (building hulls). */
  markQueriesDirty(): void {
    this.queriesDirty = true;
  }

  /** Tests/tools: hold and build NOW the 3×3 terrain chunks around (x, z); returns keys to release. */
  holdTerrainAround(x: number, z: number): string[] {
    const gx = chunkIndex(x);
    const gz = chunkIndex(z);
    const keys: string[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) keys.push(this.terrain.request(gx + dx, gz + dz));
    this.workFor(Infinity);
    this.ensureQueries();
    return keys;
  }

  stats() {
    return {
      bodies: this.world.bodies.len(),
      colliders: this.world.colliders.len(),
      terrain: { built: this.terrain.built, pending: this.terrain.pending },
      dressing: { built: this.dressing.built, pending: this.dressing.pending },
      queued: this.jobs.length,
      generating: this.generator?.inFlight ?? 0,
      steps: this.steps,
      stepMs: this.stepMs,
      maxStepMs: this.maxStepMs,
      workMs: this.workMs,
      maxWorkMs: this.maxWorkMs,
      maxJobStepMs: this.jobs.maxStepMs,
    };
  }

  free(): void {
    void this.generator?.terminate();
    this.world.free();
    this.terrain.clear();
    this.dressing.clear();
    this.jobs.clear();
  }
}
