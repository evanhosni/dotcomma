import * as RAPIER from "@dimforge/rapier3d-compat";
import type { DomainId } from "../../../../src/net/protocol";
import { DRESSING_CHUNK_SIZE } from "../../../../src/objects/dressing/types";
import { initCompute, type DomainConfig } from "../../../../src/utils/workers/vertexCompute";
import { DOMAIN_CONFIGS } from "../../../../src/world/domains/configs";
import { TICK_MS } from "../tick.js";
import { ChunkStore, JobQueue } from "./chunks.js";
import { createObstacleBodies, enumerateObstacles } from "./obstacles.js";
import { chunkCenter, chunkIndex, sampleChunkRow, TERRAIN_CHUNK_SIZE, TERRAIN_ROWS, TERRAIN_SEGMENTS } from "./terrain.js";

/**
 * Headless Rapier (the client's package, bundled from the root install) stepped at the
 * entity tick: the world, the budgeted JobQueue, and two refcounted ChunkStores —
 * TERRAIN heightfields (the client's LOD1 recipe, sampled row by row across ticks)
 * and DRESSING obstacles. Whoever needs a chunk holds it; nothing is built world-wide.
 * The height pipeline is initialized from the physics domain's shared DomainConfig
 * (src/world/domains/configs.ts); walkers in other domains run their machine but stay put.
 */

export const PHYSICS_DOMAIN: DomainId = "glitch-city";
export const PHYSICS_DT = TICK_MS / 1000;
/** Matches Player.tsx GRAVITY; kinematic bodies ignore it — here for any future dynamic body. */
export const GRAVITY = -100;
export const DEFAULT_WORK_BUDGET_MS = 8;

let rapierReady: Promise<void> | null = null;
/** The compat build embeds the WASM — no flags, no fetch. */
export const initRapier = (): Promise<void> => (rapierReady ??= RAPIER.init());

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly config: DomainConfig;
  readonly jobs = new JobQueue();
  readonly terrain: ChunkStore<RAPIER.RigidBody>;
  readonly dressing: ChunkStore<RAPIER.RigidBody[]>;
  private stepMs = 0;
  private maxStepMs = 0;
  private workMs = 0;
  private maxWorkMs = 0;
  private steps = 0;
  private queriesDirty = false;

  private constructor(world: RAPIER.World, config: DomainConfig) {
    this.world = world;
    this.config = config;
    this.terrain = new ChunkStore(
      this.jobs,
      "terrain",
      (gx, gz) => {
        const heights = new Float32Array(TERRAIN_ROWS * TERRAIN_ROWS);
        let row = 0;
        return (deadline) => {
          while (row < TERRAIN_ROWS) {
            sampleChunkRow(gx, gz, row++, heights);
            if (performance.now() >= deadline) break;
          }
          return row < TERRAIN_ROWS ? undefined : this.createHeightfield(gx, gz, heights);
        };
      },
      (body) => this.removeBody(body),
    );
    const freewayWidth = config.cityConfig.freewayWidth;
    this.dressing = new ChunkStore(
      this.jobs,
      "dressing",
      (gx, gz) => () => createObstacleBodies(this, enumerateObstacles(gx, gz, freewayWidth)),
      (bodies) => bodies.forEach((b) => this.removeBody(b)),
    );
  }

  static async create(domain: DomainId = PHYSICS_DOMAIN): Promise<PhysicsWorld> {
    const config = DOMAIN_CONFIGS[domain];
    if (!config) throw new Error(`no shared domain config for "${domain}" (src/world/domains/configs.ts)`);
    await initRapier();
    initCompute(config);
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    world.timestep = PHYSICS_DT;
    return new PhysicsWorld(world, config);
  }

  workFor(budgetMs = DEFAULT_WORK_BUDGET_MS): number {
    const ms = this.jobs.workFor(budgetMs);
    if (ms > 0) this.queriesDirty = true;
    this.workMs = ms;
    if (ms > this.maxWorkMs) this.maxWorkMs = ms;
    return ms;
  }

  /** Rapier only rebuilds its query structure inside step(), so a body stepped against
   *  a chunk built THIS tick sweeps straight through it — MEASURED: a beeble fell 1u
   *  into a just-built heightfield and sat wedged. Call after generation, before moving. */
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
      steps: this.steps,
      stepMs: this.stepMs,
      maxStepMs: this.maxStepMs,
      workMs: this.workMs,
      maxWorkMs: this.maxWorkMs,
      maxJobStepMs: this.jobs.maxStepMs,
    };
  }

  free(): void {
    this.world.free();
    this.terrain.clear();
    this.dressing.clear();
    this.jobs.clear();
  }
}

export { DRESSING_CHUNK_SIZE };
