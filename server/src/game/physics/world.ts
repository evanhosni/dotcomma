import * as RAPIER from "@dimforge/rapier3d-compat";
import { initCompute } from "../../../../src/utils/workers/vertexCompute";
import { DRESSING_CHUNK_SIZE } from "../../../../src/objects/dressing/types";
import { TICK_MS } from "../tick.js";
import { ChunkStore, JobQueue } from "./chunks.js";
import { GLITCH_CITY_DOMAIN_CONFIG } from "./domainConfig.js";
import { createObstacleBodies, enumerateObstacles } from "./obstacles.js";
import { chunkCenter, chunkIndex, sampleChunkRow, TERRAIN_CHUNK_SIZE, TERRAIN_ROWS, TERRAIN_SEGMENTS } from "./terrain.js";

/**
 * THE SERVER PHYSICS WORLD — headless Rapier (the client's own package,
 * bundled from the root install) stepped at the entity tick.
 *
 * Owns the Rapier world, the budgeted JobQueue, and two ChunkStores built on
 * it: TERRAIN heightfields (420u, the client's exact LOD1 recipe, sampled
 * row by row across ticks) and DRESSING obstacles (256u: lamp posts, signal
 * and utility poles as the client's cuboids). Whoever needs a chunk holds it
 * (physics/npc.ts); nothing is built for the whole world.
 *
 * ONE height configuration: the glitch-city DomainConfig is initialized here
 * (the only domain with terrain-walking NPCs today).
 */

export const PHYSICS_DT = TICK_MS / 1000;
/** Matches the player's manually integrated gravity (Player.tsx GRAVITY);
 *  kinematic bodies ignore world gravity — it is here for any future dynamic body. */
export const GRAVITY = -100;
/** Default per-tick generation budget (chunk rows, obstacle enumeration, hulls). */
export const DEFAULT_WORK_BUDGET_MS = 8;

let rapierReady: Promise<void> | null = null;
/** One-time WASM init (the compat build embeds it — no flags, no fetch). */
export const initRapier = (): Promise<void> => (rapierReady ??= RAPIER.init());

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly jobs = new JobQueue();
  readonly terrain: ChunkStore<RAPIER.RigidBody>;
  readonly dressing: ChunkStore<RAPIER.RigidBody[]>;
  private stepMs = 0;
  private maxStepMs = 0;
  private workMs = 0;
  private maxWorkMs = 0;
  private steps = 0;
  /** Colliders were created/removed since the last step or query update. */
  private queriesDirty = false;

  private constructor(world: RAPIER.World) {
    this.world = world;
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
    this.dressing = new ChunkStore(
      this.jobs,
      "dressing",
      (gx, gz) => () => createObstacleBodies(this, enumerateObstacles(gx, gz)),
      (bodies) => bodies.forEach((b) => this.removeBody(b)),
    );
  }

  static async create(): Promise<PhysicsWorld> {
    await initRapier();
    initCompute(GLITCH_CITY_DOMAIN_CONFIG);
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    world.timestep = PHYSICS_DT;
    return new PhysicsWorld(world);
  }

  /** Run queued generation for up to `budgetMs` (tests pass Infinity). */
  work(budgetMs = DEFAULT_WORK_BUDGET_MS): number {
    const ms = this.jobs.work(budgetMs);
    if (ms > 0) this.queriesDirty = true; // jobs create colliders
    this.workMs = ms;
    if (ms > this.maxWorkMs) this.maxWorkMs = ms;
    return ms;
  }

  /**
   * Make colliders created since the last step visible to QUERIES (raycasts,
   * the character controller's shape casts). Rapier only rebuilds its query
   * structure inside step(), so a body stepped against a chunk built THIS
   * tick would sweep straight through it — MEASURED: a beeble fell 1u into a
   * just-built heightfield on its first step and sat wedged. Call after
   * generation and before moving anything.
   */
  ensureQueries(): void {
    if (!this.queriesDirty) return;
    this.world.updateSceneQueries();
    this.queriesDirty = false;
  }

  /** Advance one tick; kinematic bodies move to their next translations. */
  step(): number {
    const t0 = performance.now();
    this.world.step();
    this.queriesDirty = false;
    this.steps++;
    this.stepMs = performance.now() - t0;
    if (this.stepMs > this.maxStepMs) this.maxStepMs = this.stepMs;
    return this.stepMs;
  }

  // ── bodies ───────────────────────────────────────────────────────────────

  private createHeightfield(gx: number, gz: number, heights: Float32Array): RAPIER.RigidBody {
    const desc = RAPIER.ColliderDesc.heightfield(TERRAIN_SEGMENTS, TERRAIN_SEGMENTS, heights, { x: TERRAIN_CHUNK_SIZE, y: 1, z: TERRAIN_CHUNK_SIZE });
    // Desc before body, like the client: a failure can't leave an empty body.
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(chunkCenter(gx), 0, chunkCenter(gz)));
    this.world.createCollider(desc, body);
    this.queriesDirty = true;
    return body;
  }

  /** A kinematic capsule (feet at `feetY`) — every NPC and player body. */
  createCapsule(x: number, feetY: number, z: number, radius: number, height: number): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const halfHeight = height / 2;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, feetY + halfHeight, z));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight - radius, radius), body);
    this.queriesDirty = true;
    return { body, collider };
  }

  removeBody(body: RAPIER.RigidBody): void {
    this.world.removeRigidBody(body); // removes its colliders too
    this.queriesDirty = true;
  }

  /** For code that creates colliders through `world` directly (building hulls). */
  markQueriesDirty(): void {
    this.queriesDirty = true;
  }

  // ── convenience for tests/tools ──────────────────────────────────────────

  /** Hold and build NOW the 3×3 terrain chunks around (x, z); returns keys to release. */
  holdTerrainAround(x: number, z: number): string[] {
    const gx = chunkIndex(x);
    const gz = chunkIndex(z);
    const keys: string[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) keys.push(this.terrain.request(gx + dx, gz + dz));
    this.work(Infinity);
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
