import { computeVertexData } from "../../../../src/utils/workers/vertexCompute";
import { DRESSING_CHUNK_SIZE } from "../../../../src/objects/dressing/types";
import { chunkIndicesNear } from "./chunks.js";
import { quantizeVelocity, SPAWN_CLEARANCE, type NpcBody, type Pose } from "./npcBody.js";
import type { PhysicsWorld } from "./physicsWorld.js";
import { TERRAIN_CHUNK_SIZE } from "./terrain.js";
import { Walker, type CapsuleShape } from "./walker.js";

/**
 * A walking NPC: its Walker, the terrain + dressing chunks it HOLDS so the ground
 * around it exists, and the player's two fix-ups (stuck escape, analytic backstop).
 * A body whose held chunks aren't built yet simply doesn't move; nothing stalls the tick.
 */

/** Hold the neighbor chunk once the body is this close to a chunk edge. */
const HOLD_MARGIN = 12;
const HOLD_RECHECK_DIST = 4;
const BACKSTOP_INTERVAL = 10; // ticks
const BACKSTOP_TOLERANCE = 2;
/** Intent but ~no movement for this many ticks → embedded → lift onto the surface;
 *  not embedded (a wall) → re-check after the backoff. */
const STUCK_TICKS_TRIGGER = 3;
const STUCK_EMBED_MIN = 0.1;
const STUCK_RECHECK_BACKOFF = 20;

let phaseCounter = 0;

export class GroundBody implements NpcBody {
  readonly walker: Walker;
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

  step(dt: number, vx: number, vz: number, vy: number | null): void {
    this.updateHolds();
    this.intentSpeedSq = vx * vx + vz * vz;
    if (this.ready) this.walker.step(dt, vx, vz, vy);
  }

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
    out.vx = quantizeVelocity((out.x - this.lastPublishedPose.x) / dt);
    out.vy = quantizeVelocity((out.y - this.lastPublishedPose.y) / dt);
    out.vz = quantizeVelocity((out.z - this.lastPublishedPose.z) / dt);
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
    // request() every wanted key, then release every previously held key: kept keys net 0, dropped keys −1.
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
