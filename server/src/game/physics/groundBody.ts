import { computeVertexData } from "../../../../src/utils/workers/vertexCompute";
import { DRESSING_CHUNK_SIZE } from "../../../../src/objects/dressing/types";
import { chunkIndicesNear } from "./chunks.js";
import { quantizeVelocity, SPAWN_CLEARANCE, type NpcBody, type Pose } from "./npcBody.js";
import type { PhysicsWorld } from "./physicsWorld.js";
import { TERRAIN_CHUNK_SIZE } from "./terrain.js";
import { Walker, type CapsuleShape } from "./walker.js";

/**
 * GROUND BODY — a walking NPC: its Walker (the capsule on the shared
 * resolver), the terrain + dressing chunks it HOLDS so the ground and
 * obstacles around it exist, and the two fix-ups the player also has (stuck
 * escape, analytic terrain backstop).
 *
 * A body whose held chunks aren't built yet simply doesn't move (its chunks
 * build row by row on the world's budget); nothing stalls the tick.
 */

/** Hold the neighbor chunk once the body is this close to a chunk edge. */
const HOLD_MARGIN = 12;
/** Re-evaluate holds after the body moved this far from the last check. */
const HOLD_RECHECK_DIST = 4;
/** Analytic terrain backstop: cadence (ticks) and how far under counts. */
const BACKSTOP_INTERVAL = 10;
const BACKSTOP_TOLERANCE = 2;
/** Stuck escape (Player.tsx has the same): intent but ~no movement for this
 *  many ticks → embedded in the surface → lift onto it; not embedded (a wall,
 *  legitimately) → re-check after the backoff. */
const STUCK_TICKS_TRIGGER = 3;
const STUCK_EMBED_MIN = 0.1;
const STUCK_RECHECK_BACKOFF = 20;

let phaseCounter = 0;

export class GroundBody implements NpcBody {
  readonly walker: Walker;
  /** Every chunk this body holds is built — it may move. */
  ready = false;
  private terrainKeys = new Set<string>();
  private dressingKeys = new Set<string>();
  private anchorX = NaN;
  private anchorZ = NaN;
  private intentSq = 0;
  private stuckTicks = 0;
  private ticks = 0;
  private readonly phase = phaseCounter++ % BACKSTOP_INTERVAL;
  private readonly prev = { x: 0, y: 0, z: 0 };

  /** Placed ON the analytic ground at (x, z) — the server owns the terrain. */
  constructor(private readonly pw: PhysicsWorld, x: number, z: number, shape: CapsuleShape) {
    const feet = computeVertexData(x, z).height + SPAWN_CLEARANCE;
    this.walker = new Walker(pw, x, feet, z, shape);
    this.prev.x = x;
    this.prev.y = feet;
    this.prev.z = z;
  }

  get x(): number {
    return this.prev.x;
  }
  get y(): number {
    return this.prev.y;
  }
  get z(): number {
    return this.prev.z;
  }

  /** Before the world step: hold the chunks under the body; if they're all
   *  built, resolve the machine's intent through the shared resolver. */
  step(dt: number, vx: number, vz: number, vy: number | null): void {
    this.updateHolds();
    this.intentSq = vx * vx + vz * vz;
    if (this.ready) this.walker.step(dt, vx, vz, vy);
  }

  /** After the world step: the resolved pose + actual velocity, with the
   *  stuck escape and terrain backstop applied. */
  pose(dt: number, out: Pose): Pose {
    this.ticks++;
    const w = this.walker;
    if (this.ready) {
      const p = w.position();
      const feet = w.feetY();
      const movedSq = (p.x - this.prev.x) ** 2 + (p.z - this.prev.z) ** 2;
      // Stuck escape: wanted to move, didn't (a sweep starting inside a
      // triangle returns ~zero) → lift onto the analytic surface if embedded.
      if (this.intentSq > 1e-6 && movedSq < this.intentSq * dt * dt * 0.0025) this.stuckTicks++;
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
        // Backstop (the player has the same): clearly under the surface → back on it.
        const h = computeVertexData(p.x, p.z).height;
        if (feet < h - BACKSTOP_TOLERANCE) w.placeFeet(p.x, h + SPAWN_CLEARANCE, p.z);
      }
    }
    const q = w.position();
    out.x = q.x;
    out.y = w.feetY();
    out.z = q.z;
    out.vx = quantizeVelocity((out.x - this.prev.x) / dt);
    out.vy = quantizeVelocity((out.y - this.prev.y) / dt);
    out.vz = quantizeVelocity((out.z - this.prev.z) / dt);
    this.prev.x = out.x;
    this.prev.y = out.y;
    this.prev.z = out.z;
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
    // request() bumps refs for every wanted key (new AND already held); then
    // releasing every previously held key nets held keys to +0 and dropped
    // keys to −1 → released.
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
