import { computeVertexData } from "../../../../src/utils/workers/vertexCompute";
import { DRESSING_CHUNK_SIZE } from "../../../../src/objects/dressing/types";
import { chunkIndicesNear } from "./chunks.js";
import { TERRAIN_CHUNK_SIZE } from "./terrain.js";
import { Walker, type CapsuleShape } from "./walker.js";
import type { PhysicsWorld } from "./world.js";

/**
 * One simulated actor's Walker + the terrain/dressing chunks it HOLDS + the
 * player's two fix-ups (stuck escape, analytic backstop). A body whose held
 * chunks aren't built yet simply doesn't move; nothing stalls the tick.
 */

/** Hold the neighbor chunk once the body is this close to a chunk edge (u). */
const HOLD_MARGIN = 12;
/** Re-evaluate holds after the body moved this far (u). */
const HOLD_RECHECK_DIST = 4;
const SPAWN_CLEARANCE = 0.05;
/** Backstop cadence (ticks) and how far under the surface counts (u). */
const BACKSTOP_INTERVAL = 10;
const BACKSTOP_TOLERANCE = 2;
/** Intent but ~no movement for this many ticks → stuck check; a wall (not embedded)
 *  re-checks after the backoff. Mirrors Player.tsx. */
const STUCK_TICKS_TRIGGER = 3;
const STUCK_EMBED_MIN = 0.1;
const STUCK_RECHECK_BACKOFF = 20;
/** Rounded so float noise doesn't re-publish every tick. */
const VEL_QUANTUM = 0.01;
const quantize = (v: number): number => Math.round(v / VEL_QUANTUM) * VEL_QUANTUM;

export interface Pose {
  x: number;
  /** Feet. */
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

let phaseCounter = 0;

export class NpcBody {
  readonly walker: Walker;
  /** Every held chunk is built. */
  ready = false;
  private terrainKeys = new Set<string>();
  private dressingKeys = new Set<string>();
  private anchorX = NaN;
  private anchorZ = NaN;
  private intentSpeedSq = 0;
  private stuckTicks = 0;
  private ticks = 0;
  private readonly phase = phaseCounter++ % BACKSTOP_INTERVAL;
  private readonly lastPublishedPose = { x: 0, y: 0, z: 0 };

  constructor(private readonly pw: PhysicsWorld, x: number, z: number, shape: CapsuleShape) {
    const feet = computeVertexData(x, z).height + SPAWN_CLEARANCE;
    this.walker = new Walker(pw, x, feet, z, shape);
    this.lastPublishedPose.x = x;
    this.lastPublishedPose.y = feet;
    this.lastPublishedPose.z = z;
  }

  get x(): number {
    return this.lastPublishedPose.x;
  }
  get y(): number {
    return this.lastPublishedPose.y;
  }
  get z(): number {
    return this.lastPublishedPose.z;
  }

  /** Call BEFORE the world step. */
  step(dt: number, vx: number, vz: number, vy: number | null): void {
    this.updateHolds();
    this.intentSpeedSq = vx * vx + vz * vz;
    if (this.ready) this.walker.step(dt, vx, vz, vy);
  }

  /** Call AFTER the world step: feet position + ACTUAL velocity (what gets published). */
  resolvePose(dt: number, out: Pose): Pose {
    this.ticks++;
    const w = this.walker;
    if (this.ready) {
      const p = w.position();
      const feet = w.feetY();
      const movedSq = (p.x - this.lastPublishedPose.x) ** 2 + (p.z - this.lastPublishedPose.z) ** 2;
      // A sweep starting inside a triangle returns ~zero movement.
      if (this.intentSpeedSq > 1e-6 && movedSq < this.intentSpeedSq * dt * dt * 0.0025) this.stuckTicks++;
      else if (this.stuckTicks > 0) this.stuckTicks = 0;
      if (this.stuckTicks >= STUCK_TICKS_TRIGGER) {
        const h = computeVertexData(p.x, p.z).height;
        if (feet < h - STUCK_EMBED_MIN) {
          w.placeFeet(p.x, h + SPAWN_CLEARANCE, p.z);
          this.stuckTicks = 0;
        } else {
          this.stuckTicks = -STUCK_RECHECK_BACKOFF;
        }
      } else if ((this.ticks + this.phase) % BACKSTOP_INTERVAL === 0) {
        const h = computeVertexData(p.x, p.z).height;
        if (feet < h - BACKSTOP_TOLERANCE) w.placeFeet(p.x, h + SPAWN_CLEARANCE, p.z);
      }
    }
    const q = w.position();
    out.x = q.x;
    out.y = w.feetY();
    out.z = q.z;
    out.vx = quantize((out.x - this.lastPublishedPose.x) / dt);
    out.vy = quantize((out.y - this.lastPublishedPose.y) / dt);
    out.vz = quantize((out.z - this.lastPublishedPose.z) / dt);
    this.lastPublishedPose.x = out.x;
    this.lastPublishedPose.y = out.y;
    this.lastPublishedPose.z = out.z;
    return out;
  }

  private updateHolds(): void {
    const p = this.walker.position();
    if ((p.x - this.anchorX) ** 2 + (p.z - this.anchorZ) ** 2 < HOLD_RECHECK_DIST * HOLD_RECHECK_DIST) {
      if (!this.ready) this.ready = this.holdsReady();
      return;
    }
    this.anchorX = p.x;
    this.anchorZ = p.z;
    // Request all wanted, then release all previously held: kept keys net to 0, dropped keys to −1.
    const wantT = new Set(chunkIndicesNear(p.x, p.z, TERRAIN_CHUNK_SIZE, HOLD_MARGIN).map(([gx, gz]) => this.pw.terrain.request(gx, gz)));
    const wantD = new Set(chunkIndicesNear(p.x, p.z, DRESSING_CHUNK_SIZE, HOLD_MARGIN).map(([gx, gz]) => this.pw.dressing.request(gx, gz)));
    for (const k of this.terrainKeys) this.pw.terrain.release(k);
    for (const k of this.dressingKeys) this.pw.dressing.release(k);
    this.terrainKeys = wantT;
    this.dressingKeys = wantD;
    this.ready = this.holdsReady();
  }

  private holdsReady(): boolean {
    for (const k of this.terrainKeys) if (!this.pw.terrain.isReady(k)) return false;
    for (const k of this.dressingKeys) if (!this.pw.dressing.isReady(k)) return false;
    return true;
  }

  dispose(): void {
    this.walker.dispose();
    for (const k of this.terrainKeys) this.pw.terrain.release(k);
    for (const k of this.dressingKeys) this.pw.dressing.release(k);
    this.terrainKeys.clear();
    this.dressingKeys.clear();
  }
}
