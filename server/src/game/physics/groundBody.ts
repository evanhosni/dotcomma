import { DRESSING_CHUNK_SIZE } from "../../../../src/objects/dressing/types";
import { chunkIndicesNear, type ChunkStore } from "./chunks.js";
import { SPAWN_CLEARANCE, writeResolvedPose, type NpcBody, type Pose } from "./npcBody.js";
import type { PhysicsWorld } from "./physicsWorld.js";
import { TERRAIN_CHUNK_SIZE } from "./terrain.js";
import { Walker, type CapsuleShape } from "./walker.js";

/**
 * A walking NPC: its Walker, the terrain + dressing chunks it HOLDS so the ground
 * around it exists, and the player's two fix-ups (stuck escape, analytic backstop).
 * A body whose held chunks aren't built yet simply doesn't move; nothing stalls the tick.
 * Its analytic height queries (spawn ground, backstop, stuck check) go through
 * `PhysicsWorld.heightAt`: with the generation worker they are answered off the tick and
 * applied on a later one, so a body in a fresh area never blocks a tick on a cold pipeline.
 */

/** Hold the neighbor chunk once the body is this close to a chunk edge. */
const HOLD_MARGIN = 12;
const HOLD_RECHECK_DIST = 4;
const BACKSTOP_INTERVAL_TICKS = 10;
const BACKSTOP_TOLERANCE = 2;
/** Intent but ~no movement for this many ticks → embedded → lift onto the surface;
 *  not embedded (a wall) → re-check after the backoff. */
const STUCK_TICKS_TRIGGER = 3;
const STUCK_EMBED_MIN = 0.1;
const STUCK_RECHECK_BACKOFF = 20;
/** An answer for a point the body has since walked this far from is dropped (a 40° slope moves the
 *  ground 0.84u per unit — inside the backstop's tolerance); the next interval asks again. */
const STALE_HEIGHT_DIST = 1;

/** One chunk layer this body holds around itself. */
interface ChunkHold {
  store: Pick<ChunkStore<unknown, unknown>, "request" | "release" | "isReady">;
  chunkSize: number;
  keys: Set<string>;
}

/** NaN until answered. */
interface HeightQuery {
  x: number;
  z: number;
  height: number;
}

let phaseCounter = 0;

export class GroundBody implements NpcBody {
  private readonly walker: Walker;
  private readonly holds: ChunkHold[];
  private holdsBuilt = false;
  /** The spawn ground, until it has been answered and the walker placed on it. */
  private spawn: HeightQuery | null;
  private heightQuery: HeightQuery | null = null;
  private anchorX = NaN;
  private anchorZ = NaN;
  private intentSpeedSq = 0;
  private stuckTicks = 0;
  private ticks = 0;
  private readonly phase = phaseCounter++ % BACKSTOP_INTERVAL_TICKS;
  private readonly lastPublishedPose = { x: 0, y: 0, z: 0 };

  /** `hintFeetY` stands in for the ground until it is answered (the registration's y: the client's own ground). */
  constructor(private readonly pw: PhysicsWorld, x: number, z: number, shape: CapsuleShape, hintFeetY: number) {
    const spawn = this.askHeight(x, z);
    const answered = !Number.isNaN(spawn.height);
    const feet = answered ? spawn.height + SPAWN_CLEARANCE : hintFeetY;
    this.spawn = answered ? null : spawn;
    this.walker = new Walker(pw, x, feet, z, shape);
    this.holds = [
      { store: pw.terrain, chunkSize: TERRAIN_CHUNK_SIZE, keys: new Set() },
      { store: pw.dressing, chunkSize: DRESSING_CHUNK_SIZE, keys: new Set() },
    ];
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

  get ready(): boolean {
    return this.holdsBuilt && this.spawn === null;
  }

  step(dt: number, vx: number, vz: number, vy: number | null): void {
    this.placeOnSpawnGround();
    this.updateHolds();
    this.intentSpeedSq = vx * vx + vz * vz;
    if (this.ready) this.walker.step(dt, vx, vz, vy);
  }

  resolvePose(dt: number, out: Pose): Pose {
    this.ticks++;
    if (this.ready) this.liftOutOfGround(dt);
    const p = this.walker.position();
    return writeResolvedPose(this.lastPublishedPose, p.x, this.walker.feetY(), p.z, dt, out);
  }

  /** A body never moves before this: it stands where it was registered. */
  private placeOnSpawnGround(): void {
    const s = this.spawn;
    if (s === null || Number.isNaN(s.height)) return;
    this.walker.placeFeet(s.x, s.height + SPAWN_CLEARANCE, s.z);
    this.pw.markQueriesDirty();
    this.spawn = null;
  }

  private askHeight(x: number, z: number): HeightQuery {
    const q: HeightQuery = { x, z, height: NaN };
    this.pw.heightAt(x, z, (h) => {
      q.height = h;
    });
    return q;
  }

  /** The player's two fix-ups: a body wedged inside the surface (intent, ~no movement) is lifted
   *  at once; otherwise every BACKSTOP_INTERVAL_TICKS (phase-offset) one fallen through is. Each
   *  asks for the ground and acts on the answer the tick it is there (the same tick in place). */
  private liftOutOfGround(dt: number): void {
    const w = this.walker;
    const p = w.position();
    const movedSq = (p.x - this.lastPublishedPose.x) ** 2 + (p.z - this.lastPublishedPose.z) ** 2;
    // A sweep starting inside a triangle returns ~zero movement.
    if (this.intentSpeedSq > 1e-6 && movedSq < this.intentSpeedSq * dt * dt * 0.0025) this.stuckTicks++;
    else if (this.stuckTicks > 0) this.stuckTicks = 0;
    const stuck = this.stuckTicks >= STUCK_TICKS_TRIGGER;
    if (this.heightQuery === null && (stuck || (this.ticks + this.phase) % BACKSTOP_INTERVAL_TICKS === 0)) {
      this.heightQuery = this.askHeight(p.x, p.z);
    }
    const q = this.heightQuery;
    if (q === null || Number.isNaN(q.height)) return;
    this.heightQuery = null;
    if ((p.x - q.x) ** 2 + (p.z - q.z) ** 2 > STALE_HEIGHT_DIST * STALE_HEIGHT_DIST) return;
    const feet = w.feetY();
    if (stuck) {
      if (feet < q.height - STUCK_EMBED_MIN) {
        w.placeFeet(p.x, q.height + SPAWN_CLEARANCE, p.z);
        this.stuckTicks = 0;
      } else {
        this.stuckTicks = -STUCK_RECHECK_BACKOFF;
      }
    } else if (feet < q.height - BACKSTOP_TOLERANCE) {
      w.placeFeet(p.x, q.height + SPAWN_CLEARANCE, p.z);
    }
  }

  private updateHolds(): void {
    const p = this.walker.position();
    if ((p.x - this.anchorX) ** 2 + (p.z - this.anchorZ) ** 2 < HOLD_RECHECK_DIST * HOLD_RECHECK_DIST) {
      if (!this.holdsBuilt) this.holdsBuilt = this.holdsReady();
      return;
    }
    this.anchorX = p.x;
    this.anchorZ = p.z;
    // request() every wanted key, then release every previously held key: kept keys net 0, dropped keys −1.
    const wanted = this.holds.map(({ store, chunkSize }) =>
      new Set(chunkIndicesNear(p.x, p.z, chunkSize, HOLD_MARGIN).map(([gx, gz]) => store.request(gx, gz))),
    );
    this.holds.forEach((hold, i) => {
      for (const k of hold.keys) hold.store.release(k);
      hold.keys = wanted[i];
    });
    this.holdsBuilt = this.holdsReady();
  }

  private holdsReady(): boolean {
    for (const { store, keys } of this.holds) for (const k of keys) if (!store.isReady(k)) return false;
    return true;
  }

  dispose(): void {
    this.walker.dispose();
    for (const { store, keys } of this.holds) {
      for (const k of keys) store.release(k);
      keys.clear();
    }
  }
}
