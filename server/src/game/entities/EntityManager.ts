import type { DomainId, EntityRegisterItem, EntityUpdateFields } from "../../../../src/net/protocol/types";
import { getActorSpec } from "../../../../src/world/domains";
import { DOOR_INTERACT_REACH } from "../../../../src/objects/actors/building/spec";
import { INTERACT_REACH_SLACK, serverInteractReachSq } from "../../../../src/objects/actors/spec";
import type { ActorSpec } from "../../../../src/objects/actors/spec";
import { StateMachineRunner } from "../../../../src/objects/actors/state/StateMachineRunner";
import { RAGDOLL_IMPULSE_KEY } from "../../../../src/objects/actors/state/constants";
import type { Cut, Vec3Tuple, Wound } from "../../../../src/net/protocol/types";
import { MAX_CUTS } from "../../../../src/objects/actors/slices/constants";
import { CORPSE_SECONDS, KILL_CARRY, KILL_PUSH, MAX_WOUNDS } from "../../../../src/objects/actors/wounds/constants";
import type { WeaponSpec } from "../../../../src/weapons/spec";
import { isPlayerSolid, PLAYER_DETECTABILITY } from "../../../../src/player/spec";
import type { RagdollImpulse } from "../../../../src/objects/actors/state/types";
import { createBuildingCollider, doorOffsetsFor, createNpcBody } from "../physics/bodies/index.js";
import type { Pose } from "../physics/bodies/types.js";
import { DEFAULT_WORK_BUDGET_MS, PHYSICS_DOMAIN } from "../physics/constants.js";
import type { PhysicsWorld } from "../physics/physicsWorld.js";
import { PlayerBodies } from "../physics/bodies/PlayerBodies.js";
import { TICK_HZ, TICK_SECONDS } from "../constants.js";
import { clipDurationsOf, createPublished, fullUpdate, publishTick } from "./utils.js";
import type { EntityRecord, PlayerView, EntityHost, EntityManagerOptions } from "./types";

/**
 * THE authority for every synced actor (CLAUDE.md → Entity sync). Entities exist
 * because clients register them; the first registration creates the record, zero
 * registrants forgets it. A kind in the actor catalog runs its state machine here
 * with the nearest player as "the player" and its body on the server physics world;
 * building kinds get a sealed hull; unknown kinds are static records with
 * replicated state. Inputs cross the wire, never triggers.
 */

const MAX_PLAYER_EXTRAPOLATION_S = 0.5;
const STATS_LOG_EVERY_TICKS = TICK_HZ * 10;
const SLOW_TICK_WARN_MS = 50;
const NO_PLAYER_POSITION = { x: 1e9, y: 0, z: 1e9 };
const DOOR_ACTION = /^door:(\d+)$/;
const DOOR_REACH_SQ = (DOOR_INTERACT_REACH + INTERACT_REACH_SLACK) ** 2;
/** A shot's hit point may stand this far from the entity's published feet (a ragdoll lies off them). */
const HIT_REACH = 8;

const nearestPlayer = (e: EntityRecord, players: PlayerView[]): { pos: { x: number; y: number; z: number }; distSq: number } => {
  let best: PlayerView | null = null;
  let bestSq = Infinity;
  for (const p of players) {
    if (PLAYER_DETECTABILITY[p.form] <= 0) continue;
    const dSq = (p.x - e.x) ** 2 + (p.z - e.z) ** 2;
    if (dSq < bestSq) {
      bestSq = dSq;
      best = p;
    }
  }
  return best ? { pos: best, distSq: bestSq } : { pos: NO_PLAYER_POSITION, distSq: Infinity };
};

/** A player as of `now`: moved along its last reported velocity, at most MAX_PLAYER_EXTRAPOLATION_S. */
const extrapolate = (p: PlayerView, now: number): PlayerView => {
  const age = Math.min((now - p.lastMoveAt) / 1000, MAX_PLAYER_EXTRAPOLATION_S);
  return { ...p, x: p.x + p.vx * age, z: p.z + p.vz * age };
};

export class EntityManager {
  private readonly entities = new Map<string, EntityRecord>();
  private readonly bySession = new Map<string, Set<string>>();
  /** Simulation time (s), advanced exactly one tick per tick so a machine's
   *  `elapsed` agrees with its `delta` (like the client's frame clock). */
  private elapsed = 0;
  private readonly playerBodies: PlayerBodies | null;
  private readonly workBudgetMs: number;
  private readonly log: boolean;
  private readonly specs: (kind: string) => ActorSpec | undefined;
  private readonly poseScratch: Pose = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  private tickNo = 0;
  /** NPCs dead, by id → when (ms): their corpses lie CORPSE_SECONDS, and an NPC forgotten and registered
   *  again meanwhile comes back dead. */
  private readonly deadAt = new Map<string, { domain: DomainId; at: number }>();
  private maxTickMs = 0;
  private npcCount = 0;

  constructor(
    private readonly host: EntityHost,
    private readonly physics: PhysicsWorld | null = null,
    opts: EntityManagerOptions = {},
  ) {
    this.playerBodies = physics ? new PlayerBodies(physics) : null;
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

  register(sessionId: string, domain: DomainId, items: EntityRegisterItem[]): void {
    for (const item of items) {
      if (this.host.isRetired?.(domain, item.id)) continue;
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
    this.playerBodies?.dispose();
  }

  private create(item: EntityRegisterItem, domain: DomainId): EntityRecord {
    const spec = this.specs(item.kind);
    const physical = this.physics !== null && domain === PHYSICS_DOMAIN;
    // The server owns the ground: the registration's y is only a hint, held until the server's height is in.
    const npc = spec && physical ? createNpcBody(this.physics!, spec, item.x, item.z, item.y) : null;
    if (npc) this.npcCount++;
    const position = { x: item.x, y: npc ? npc.y : item.y, z: item.z };
    const e: EntityRecord = {
      ...createPublished(position.x, position.y, position.z),
      id: item.id,
      kind: item.kind,
      domain,
      registrants: new Set(),
      runner: spec?.stateMachine
        ? new StateMachineRunner(spec.stateMachine, { current: position }, { current: null }, {
            animation: { defaults: spec.animation, durations: clipDurationsOf(spec) },
            motion: spec.motion,
          })
        : null,
      position,
      npc,
      hull: null,
    };
    this.entities.set(e.id, e);
    if (spec?.hull && physical) this.queueHull(e.id);
    // Dead before it was forgotten: it comes back dead.
    if (this.deadAt.has(e.id)) {
      e.state = { dead: true, health: 0 };
      e.runner?.setRagdoll(true);
    }
    return e;
  }

  /** Budgeted queue: a client entering the city registers hundreds of buildings at once. The job
   *  serves whatever record holds the id when it runs: one disposed and re-registered before its
   *  job ran is a new record whose own enqueue the queue dedupes away (it was left without a hull). */
  private queueHull(id: string): void {
    this.physics!.jobs.enqueue(`hull:${id}`, () => {
      const cur = this.entities.get(id);
      const attrs = cur && !cur.hull && cur.domain === PHYSICS_DOMAIN ? this.specs(cur.kind)?.hull : undefined;
      if (attrs) cur!.hull = createBuildingCollider(this.physics!, attrs, cur!.x, cur!.y, cur!.z);
      return true;
    });
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

  isDead(id: string): boolean {
    return this.deadAt.has(id);
  }

  /** A hit (World.shoot): the wounds are kept with the entity's state for every client to draw; an NPC with
   *  health loses it, and at 0 dies: limp for good, thrown along the bullet. A dead body keeps a blade's
   *  cuts (the first MAX_CUTS: every client cuts them in that order) and a blast's centre (`gib`: it burst).
   *  False when the hit cannot be this entity's (another domain, or too far from it). */
  shoot(
    id: string,
    domain: DomainId,
    weapon: WeaponSpec,
    blow: { wounds: Wound[]; cuts?: Cut[]; gib?: Vec3Tuple },
    dir: [number, number, number],
    at: [number, number, number],
    now = Date.now(),
  ): boolean {
    const { wounds } = blow;
    const e = this.entities.get(id);
    if (!e || e.domain !== domain || (at[0] - e.x) ** 2 + (at[2] - e.z) ** 2 > HIT_REACH * HIT_REACH) return false;
    const kept = [...((e.state.wounds as Wound[] | undefined) ?? []), ...wounds].slice(-MAX_WOUNDS);
    const maxHealth = this.specs(e.kind)?.health;
    if (maxHealth === undefined) {
      e.state = { ...e.state, wounds: kept };
      this.send(e, { state: e.state });
      return true;
    }
    const health = Math.max(0, ((e.state.health as number | undefined) ?? maxHealth) - weapon.damage);
    e.state = { ...e.state, wounds: kept, health };
    if (health <= 0) e.state = withBlow(e.state, blow);
    if (health > 0 || this.deadAt.has(id)) {
      this.send(e, { state: e.state });
      return true;
    }
    this.deadAt.set(id, { domain, at: now });
    e.state = { ...e.state, dead: true };
    this.setRagdoll(id, true, { bone: wounds[0]?.entry.b[0] ?? "", x: dir[0] * KILL_PUSH, y: dir[1] * KILL_PUSH, z: dir[2] * KILL_PUSH, carry: KILL_CARRY });
    return true;
  }

  /** Limp or back up (the machine's built-in ragdoll states). The impulse is replicated with the entity's
   *  state, so every client starts the same fall. */
  setRagdoll(id: string, on: boolean, impulse?: RagdollImpulse, hold = false): void {
    const e = this.entities.get(id);
    if (!e?.runner || (!on && this.deadAt.has(id))) return;
    e.runner.setRagdoll(on, impulse, hold);
    const { [RAGDOLL_IMPULSE_KEY]: _previous, ...rest } = e.state;
    e.state = on && impulse ? { ...rest, [RAGDOLL_IMPULSE_KEY]: impulse } : rest;
    this.send(e, { state: e.state });
  }

  /** Forgets an entity for good (an NPC that became a player): its registrants keep nothing, and the
   *  host's `isRetired` refuses it from now on. */
  retire(id: string): void {
    const e = this.entities.get(id);
    if (!e) return;
    for (const sessionId of e.registrants) this.bySession.get(sessionId)?.delete(id);
    this.dispose(e);
  }

  /** A mouse action becomes the machine's blackboard flag (its own triggers decide);
   *  "door:<i>" toggles replicated state generically. Both are gated on the sender's
   *  reported position: a mouse action from the actor's origin, a door from the door's
   *  own position (a building's origin is its center, 9–16u from a facade door). */
  interact(sessionId: string, id: string, action: string, now = Date.now()): void {
    const e = this.entities.get(id);
    if (!e || !e.registrants.has(sessionId)) return;
    // A registrant is always in the entity's domain: a domain change unregisters everything first.
    const from = this.playerView(e.domain, sessionId, now);
    const door = DOOR_ACTION.exec(action);
    if (door) {
      const idx = Number(door[1]);
      if (this.canReachDoor(e, idx, from)) this.toggleDoor(e, idx);
      return;
    }
    if (from && !this.withinOriginReach(e, from)) return;
    e.runner?.raiseMouseAction(action);
  }

  private withinOriginReach(e: EntityRecord, from: PlayerView): boolean {
    return (from.x - e.x) ** 2 + (from.z - e.z) ** 2 <= serverInteractReachSq(this.specs(e.kind));
  }

  /** A building kind knows its doors from the seeded plan the hull is built from: the index must
   *  exist and the player must be within reach of THAT door. Other kinds keep the origin gate. */
  private canReachDoor(e: EntityRecord, idx: number, from: PlayerView | undefined): boolean {
    const hull = this.specs(e.kind)?.hull;
    if (!hull) return !from || this.withinOriginReach(e, from);
    const doors = doorOffsetsFor(hull, e.x, e.z);
    if (idx >= doors.length / 2) return false;
    if (!from) return true;
    return (from.x - e.x - doors[idx * 2]) ** 2 + (from.z - e.z - doors[idx * 2 + 1]) ** 2 <= DOOR_REACH_SQ;
  }

  private toggleDoor(e: EntityRecord, idx: number): void {
    const doors = Array.isArray(e.state.doors) ? [...(e.state.doors as boolean[])] : [];
    doors[idx] = !doors[idx];
    e.state = { ...e.state, doors };
    this.send(e, { state: e.state });
  }

  /** Players of a domain, extrapolated to now. */
  private playersFor(domain: DomainId, now: number): PlayerView[] {
    const list: PlayerView[] = [];
    for (const p of this.host.playersIn(domain)) list.push(extrapolate(p, now));
    return list;
  }

  private playerView(domain: DomainId, sessionId: string, now: number): PlayerView | undefined {
    for (const p of this.host.playersIn(domain)) if (p.id === sessionId) return extrapolate(p, now);
    return undefined;
  }

  /** One simulation tick: generation work → player capsules → query refresh → every machine ticks and
   *  moves its body → ONE world step → resolved poses published. */
  tick(now = Date.now()): void {
    const tickStart = performance.now();
    this.tickNo++;
    const dt = TICK_SECONDS;
    this.elapsed += dt;
    const playersByDomain = new Map<DomainId, PlayerView[]>();
    const playersOf = (domain: DomainId): PlayerView[] => {
      let list = playersByDomain.get(domain);
      if (!list) playersByDomain.set(domain, (list = this.playersFor(domain, now)));
      return list;
    };

    this.clearCorpses(now);
    const simulate = this.preparePhysics(playersOf);
    this.stepMachines(dt, now, playersOf);
    if (simulate) this.physics!.step();
    this.publishPoses(dt, now);
    this.logTick(performance.now() - tickStart);
  }

  /** Corpses that have lain their time are gone for good. */
  private clearCorpses(now: number): void {
    for (const [id, dead] of this.deadAt) {
      if (now - dead.at < CORPSE_SECONDS * 1000) continue;
      this.deadAt.delete(id);
      this.retire(id);
      this.host.onCorpseGone?.(dead.domain, id);
    }
  }

  /** Runs the physics world's budgeted generation, syncs the player capsules and refreshes the query
   *  structure. Returns whether the world steps this tick (anything simulated at all). */
  private preparePhysics(playersOf: (domain: DomainId) => PlayerView[]): boolean {
    const pw = this.physics;
    if (!pw) return false;
    const simulate = this.npcCount > 0 || this.playerBodies!.size > 0;
    pw.workFor(this.workBudgetMs);
    if (simulate) {
      const domains = new Set<DomainId>();
      for (const e of this.entities.values()) if (e.npc) domains.add(e.domain);
      this.playerBodies!.sync([...domains].flatMap((d) => playersOf(d)).filter((p) => isPlayerSolid(p.form)));
    }
    pw.ensureQueries();
    return simulate;
  }

  /** Every machine ticks against its nearest player; its motion output drives its body. */
  private stepMachines(dt: number, now: number, playersOf: (domain: DomainId) => PlayerView[]): void {
    for (const e of this.entities.values()) {
      const r = e.runner;
      if (!r) continue;
      const { pos, distSq } = nearestPlayer(e, playersOf(e.domain));
      e.position.x = e.x;
      e.position.y = e.y;
      e.position.z = e.z;
      r.tick(this.elapsed, dt, now, pos, distSq);
      if (e.npc) {
        const m = r.motion.out;
        e.npc.step(dt, m.vx, m.vz, m.vy);
      }
    }
  }

  private publishPoses(dt: number, now: number): void {
    for (const e of this.entities.values()) {
      if (!e.runner) continue;
      const pose = e.npc ? e.npc.resolvePose(dt, this.poseScratch) : null;
      const fields = publishTick(e, pose, e.runner, now);
      if (fields) this.send(e, fields);
    }
  }

  private logTick(tickMs: number): void {
    if (tickMs > this.maxTickMs) this.maxTickMs = tickMs;
    const pw = this.physics;
    if (!this.log || !pw) return;
    if (tickMs > SLOW_TICK_WARN_MS) console.warn(`[physics] slow tick ${tickMs.toFixed(1)}ms — ${this.statsLine()}`);
    if (this.tickNo % STATS_LOG_EVERY_TICKS === 0 && (this.npcCount > 0 || pw.jobs.length > 0)) {
      console.log(`[physics] ${this.statsLine()}`);
      this.maxTickMs = 0;
    }
  }

  private send(e: EntityRecord, fields: EntityUpdateFields): void {
    this.host.sendMany(e.registrants, { t: "entity:update", id: e.id, ...fields });
  }

  private statsLine(): string {
    const s = this.physics!.stats();
    return (
      `npcs ${this.npcCount} players ${this.playerBodies!.size} | tick max ${this.maxTickMs.toFixed(1)}ms ` +
      `step ${s.stepMs.toFixed(2)}/${s.maxStepMs.toFixed(2)}ms work ${s.workMs.toFixed(1)}/${s.maxWorkMs.toFixed(1)}ms (slowest job step ${s.maxJobStepMs.toFixed(0)}ms) | ` +
      `colliders ${s.colliders} bodies ${s.bodies} terrain ${s.terrain.built}+${s.terrain.pending} dressing ${s.dressing.built}+${s.dressing.pending} queue ${s.queued} generating ${s.generating}`
    );
  }
}

/** A dead body's state with a blow's cuts (the first MAX_CUTS kept) and burst (the first blast's centre). */
const withBlow = (state: Record<string, unknown>, blow: { cuts?: Cut[]; gib?: Vec3Tuple }): Record<string, unknown> => {
  const next = { ...state };
  if (blow.cuts?.length) next.cuts = [...((state.cuts as Cut[] | undefined) ?? []), ...blow.cuts].slice(0, MAX_CUTS);
  if (blow.gib && !state.gib) next.gib = blow.gib;
  return next;
};