import type { DomainId, EntityUpdateFields, ServerMessage } from "../../../../src/net/protocol";
import type { ProxyColliderHandle } from "../../../../src/objects/actors/building/proxyCollider";
import { getActorSpec } from "../../../../src/objects/actors/catalog";
import type { ActorSpec } from "../../../../src/objects/actors/spec";
import { StateMachineRunner } from "../../../../src/objects/actors/state/runner";
import { createBuildingCollider } from "../physics/buildings.js";
import { createNpcBody, type NpcBody, type Pose } from "../physics/npcBody.js";
import { DEFAULT_WORK_BUDGET_MS, PHYSICS_DOMAIN, type PhysicsWorld } from "../physics/physicsWorld.js";
import { PlayerBodies } from "../physics/playerBodies.js";
import { TICK_HZ, TICK_MS } from "../tick.js";
import { createPublished, fullUpdate, publishTick, type Published } from "./publish.js";

export { PHYSICS_DOMAIN, TICK_HZ, TICK_MS };

/**
 * THE authority for every synced actor (CLAUDE.md → Entity sync). Entities exist
 * because clients register them; the first registration creates the record, zero
 * registrants forgets it. A kind in the actor catalog runs its state machine here
 * with the nearest player as "the player" and its body on the server physics world;
 * building kinds get a sealed hull; unknown kinds are static records with
 * replicated state. Inputs cross the wire, never triggers.
 */

const MAX_PLAYER_EXTRAPOLATION_S = 0.5;
/** A click must come from a player within this 2D reach. */
const INTERACT_REACH_SQ = 8 * 8;
const STATS_LOG_EVERY_TICKS = TICK_HZ * 10;
const SLOW_TICK_WARN_MS = 50;
const NO_PLAYER_POSITION = { x: 1e9, y: 0, z: 1e9 };

export interface PlayerView {
  id: string;
  domain: DomainId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  lastMoveAt: number;
}

export interface EntityHost {
  playersIn(domain: DomainId): Iterable<PlayerView>;
  sendMany(sessionIds: Iterable<string>, msg: ServerMessage): void;
}

export interface EntityRecord extends Published {
  id: string;
  kind: string;
  domain: DomainId;
  registrants: Set<string>;
  runner: StateMachineRunner | null;
  /** The position object the runner reads (kept equal to x/y/z). */
  position: { x: number; y: number; z: number };
  npc: NpcBody | null;
  hull: ProxyColliderHandle | null;
}

export interface EntityManagerOptions {
  /** Per-tick generation budget for the physics world (tests: Infinity). */
  workBudgetMs?: number;
  log?: boolean;
  /** Kind → spec (default: the actor catalog; tests inject kinds). */
  specs?: (kind: string) => ActorSpec | undefined;
}

interface RegisterItem {
  id: string;
  kind: string;
  x: number;
  y: number;
  z: number;
}

const nearestPlayer = (e: EntityRecord, players: PlayerView[]): { pos: { x: number; y: number; z: number }; distSq: number } => {
  let best: PlayerView | null = null;
  let bestSq = Infinity;
  for (const p of players) {
    const dSq = (p.x - e.x) ** 2 + (p.z - e.z) ** 2;
    if (dSq < bestSq) {
      bestSq = dSq;
      best = p;
    }
  }
  return best ? { pos: best, distSq: bestSq } : { pos: NO_PLAYER_POSITION, distSq: Infinity };
};

export class EntityManager {
  private readonly entities = new Map<string, EntityRecord>();
  private readonly bySession = new Map<string, Set<string>>();
  /** Simulation time (s), advanced exactly one tick per tick so a machine's
   *  `elapsed` agrees with its `delta` (like the client's frame clock). */
  private elapsed = 0;
  private readonly players: PlayerBodies | null;
  private readonly workBudgetMs: number;
  private readonly log: boolean;
  private readonly specs: (kind: string) => ActorSpec | undefined;
  private readonly poseScratch: Pose = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  private tickNo = 0;
  private maxTickMs = 0;
  private npcCount = 0;

  constructor(
    private readonly host: EntityHost,
    private readonly physics: PhysicsWorld | null = null,
    opts: EntityManagerOptions = {},
  ) {
    this.players = physics ? new PlayerBodies(physics) : null;
    this.workBudgetMs = opts.workBudgetMs ?? DEFAULT_WORK_BUDGET_MS;
    this.log = opts.log ?? true;
    this.specs = opts.specs ?? getActorSpec;
  }

  get size(): number {
    return this.entities.size;
  }

  get(id: string): EntityRecord | undefined {
    return this.entities.get(id);
  }

  register(sessionId: string, domain: DomainId, items: RegisterItem[]): void {
    for (const item of items) {
      let e = this.entities.get(item.id);
      if (e && e.domain !== domain) continue;
      if (!e) e = this.create(item, domain);
      e.registrants.add(sessionId);
      let mine = this.bySession.get(sessionId);
      if (!mine) this.bySession.set(sessionId, (mine = new Set()));
      mine.add(item.id);
      this.host.sendMany([sessionId], { t: "entity:update", id: e.id, ...fullUpdate(e, Date.now()) });
    }
  }

  private create(item: RegisterItem, domain: DomainId): EntityRecord {
    const spec = this.specs(item.kind);
    const physical = this.physics !== null && domain === PHYSICS_DOMAIN;
    const npc = spec && physical ? createNpcBody(this.physics!, spec, item.x, item.z) : null;
    if (npc) this.npcCount++;
    // The server owns the ground: the registration's y is only a hint.
    const position = { x: item.x, y: npc ? npc.y : item.y, z: item.z };
    const e: EntityRecord = {
      ...createPublished(position.x, position.y, position.z),
      id: item.id,
      kind: item.kind,
      domain,
      registrants: new Set(),
      runner: spec?.stateMachine ? new StateMachineRunner(spec.stateMachine, { current: position }, { current: null }) : null,
      position,
      npc,
      hull: null,
    };
    this.entities.set(e.id, e);
    if (spec?.hull && physical) {
      // Budgeted queue: a client entering the city registers hundreds of buildings at once.
      const attrs = spec.hull;
      this.physics!.jobs.enqueue(`hull:${e.id}`, () => {
        if (this.entities.get(e.id) === e && !e.hull) e.hull = createBuildingCollider(this.physics!, attrs, e.x, e.y, e.z);
        return true;
      });
    }
    return e;
  }

  private dispose(e: EntityRecord): void {
    e.runner?.dispose();
    if (e.npc) {
      e.npc.dispose();
      this.npcCount--;
    }
    e.hull?.dispose();
    this.entities.delete(e.id);
  }

  unregister(sessionId: string, ids: string[]): void {
    const mine = this.bySession.get(sessionId);
    for (const id of ids) {
      mine?.delete(id);
      const e = this.entities.get(id);
      if (!e) continue;
      e.registrants.delete(sessionId);
      if (e.registrants.size === 0) this.dispose(e);
    }
    if (mine && mine.size === 0) this.bySession.delete(sessionId);
  }

  removeSession(sessionId: string): void {
    const mine = this.bySession.get(sessionId);
    if (mine) this.unregister(sessionId, [...mine]);
  }

  disposeAll(): void {
    for (const e of [...this.entities.values()]) this.dispose(e);
    this.bySession.clear();
    this.players?.dispose();
  }

  /** A mouse action becomes the machine's blackboard flag (its own triggers decide);
   *  "door:<i>" toggles replicated state generically. */
  interact(sessionId: string, id: string, action: string, players: PlayerView[]): void {
    const e = this.entities.get(id);
    if (!e || !e.registrants.has(sessionId)) return;
    const from = players.find((p) => p.id === sessionId);
    if (from && (from.x - e.x) ** 2 + (from.z - e.z) ** 2 > INTERACT_REACH_SQ) return;
    if (e.runner?.raiseMouseAction(action)) return;
    const door = /^door:(\d+)$/.exec(action);
    if (door) {
      const idx = Number(door[1]);
      const doors = Array.isArray(e.state.doors) ? [...(e.state.doors as boolean[])] : [];
      doors[idx] = !doors[idx];
      e.state = { ...e.state, doors };
      this.host.sendMany(e.registrants, { t: "entity:update", id: e.id, state: e.state });
    }
  }

  /** Players of a domain, extrapolated to now. */
  playersFor(domain: DomainId, now = Date.now()): PlayerView[] {
    const list: PlayerView[] = [];
    for (const p of this.host.playersIn(domain)) {
      const age = Math.min((now - p.lastMoveAt) / 1000, MAX_PLAYER_EXTRAPOLATION_S);
      list.push({ ...p, x: p.x + p.vx * age, z: p.z + p.vz * age });
    }
    return list;
  }

  tick(now = Date.now()): void {
    const tickStart = performance.now();
    this.tickNo++;
    const dt = TICK_MS / 1000;
    this.elapsed += dt;
    const elapsed = this.elapsed;
    const playersByDomain = new Map<DomainId, PlayerView[]>();
    const playersOf = (domain: DomainId): PlayerView[] => {
      let list = playersByDomain.get(domain);
      if (!list) playersByDomain.set(domain, (list = this.playersFor(domain, now)));
      return list;
    };

    const pw = this.physics;
    const simulate = pw !== null && (this.npcCount > 0 || this.players!.size > 0);
    if (pw) {
      pw.workFor(this.workBudgetMs);
      if (simulate) {
        const domains = new Set<DomainId>();
        for (const e of this.entities.values()) if (e.npc) domains.add(e.domain);
        this.players!.sync([...domains].flatMap((d) => playersOf(d)));
      }
      pw.ensureQueries();
    }

    for (const e of this.entities.values()) {
      const r = e.runner;
      if (!r) continue;
      const { pos, distSq } = nearestPlayer(e, playersOf(e.domain));
      e.position.x = e.x;
      e.position.y = e.y;
      e.position.z = e.z;
      r.tick(elapsed, dt, now, pos, distSq);
      if (e.npc) {
        const m = r.motion.out;
        e.npc.step(dt, m.vx, m.vz, m.vy);
      }
    }

    if (simulate) pw!.step();

    for (const e of this.entities.values()) {
      if (!e.runner) continue;
      const pose = e.npc ? e.npc.resolvePose(dt, this.poseScratch) : null;
      const fields = publishTick(e, pose, e.runner, now);
      if (fields) this.send(e, fields);
    }

    const tickMs = performance.now() - tickStart;
    if (tickMs > this.maxTickMs) this.maxTickMs = tickMs;
    if (this.log && pw) {
      if (tickMs > SLOW_TICK_WARN_MS) console.warn(`[physics] slow tick ${tickMs.toFixed(1)}ms — ${this.statsLine()}`);
      if (this.tickNo % STATS_LOG_EVERY_TICKS === 0 && (this.npcCount > 0 || pw.jobs.length > 0)) {
        console.log(`[physics] ${this.statsLine()}`);
        this.maxTickMs = 0;
      }
    }
  }

  private send(e: EntityRecord, fields: EntityUpdateFields): void {
    this.host.sendMany(e.registrants, { t: "entity:update", id: e.id, ...fields });
  }

  statsLine(): string {
    const s = this.physics!.stats();
    return (
      `npcs ${this.npcCount} players ${this.players!.size} | tick max ${this.maxTickMs.toFixed(1)}ms ` +
      `step ${s.stepMs.toFixed(2)}/${s.maxStepMs.toFixed(2)}ms work ${s.workMs.toFixed(1)}/${s.maxWorkMs.toFixed(1)}ms (slowest job step ${s.maxJobStepMs.toFixed(0)}ms) | ` +
      `colliders ${s.colliders} bodies ${s.bodies} terrain ${s.terrain.built}+${s.terrain.pending} dressing ${s.dressing.built}+${s.dressing.pending} queue ${s.queued}`
    );
  }
}
