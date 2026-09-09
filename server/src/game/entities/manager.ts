import type { DomainId, EntityUpdateFields, ServerMessage } from "../../protocol.js";
import { StateMachineRunner } from "../../../../src/objects/actors/state/runner";
import { getKind } from "./kinds.js";

/**
 * ENTITY MANAGER — THE authority for every synced actor.
 *
 * The server runs each actor's state machine (the client's own config file,
 * see kinds.ts) at TICK_HZ with EVERY player in the domain as a candidate
 * "player" (nearest wins) — no client simulates, no client is favored. It
 * reads the machine's blackboard OUTPUTS (velocity, yaw, animation, state id),
 * integrates position in x/z (y is client-resolved: the server has no
 * terrain; `vy` is published for vertical motion such as ascending), and
 * publishes changed fields to the entity's registrants at ≤ TICK_HZ.
 *
 * ENTITIES EXIST BECAUSE CLIENTS REGISTER THEM: a client registers an
 * instance when it mounts it (position-based spawn ids are identical on every
 * client) and unregisters on unmount; the first registration creates the
 * record; zero registrants → forgotten (the machine stops). Interest = the
 * registrant set, per domain. A registrant is answered with the full current
 * record, so joining mid-interaction is covered.
 *
 * INPUT: clients forward clicks (`entity:interact "mouse-left-click"`); the
 * server raises the same blackboard flag the machine's mouse triggers read,
 * gated on the machine's own distance rule via the nearest player. Component-
 * defined actions ("door:2") toggle replicated `state` generically.
 */

export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;
const MAX_PLAYER_EXTRAPOLATION_S = 0.5;
/** Interaction reach: a click must come from a player this close (2D). */
const INTERACT_REACH_SQ = 8 * 8;
/** The server has no physics; the ONE contact it models is actor-vs-player,
 *  so an NPC that walks up to a player stops in front of them here exactly as
 *  its client-side body does (blocked by the player's capsule). Without it the
 *  server's copy walked THROUGH the player and ended up behind them — out of
 *  its own sight cone, so it never alerted. Radii: player 0.5 + beeble 0.5 + gap. */
const PLAYER_BLOCK_DIST = 1.3;

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

export interface EntityRecord {
  id: string;
  kind: string;
  domain: DomainId;
  registrants: Set<string>;
  // ── simulated fields (published when they change) ──
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ry: number;
  clip: string | undefined;
  clipT0: number;
  once: boolean;
  sm: string | undefined;
  state: Record<string, unknown>;
  // ── bookkeeping ──
  runner: StateMachineRunner | null;
  position: { x: number; y: number; z: number };
  dirty: EntityUpdateFields;
  hasDirty: boolean;
}

const nearestPlayer = (
  e: EntityRecord,
  players: PlayerView[],
): { pos: { x: number; y: number; z: number }; distSq: number } => {
  let best: PlayerView | null = null;
  let bestSq = Infinity;
  for (const p of players) {
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const dSq = dx * dx + dz * dz;
    if (dSq < bestSq) {
      bestSq = dSq;
      best = p;
    }
  }
  return best ? { pos: best, distSq: bestSq } : { pos: FAR, distSq: Infinity };
};
const FAR = { x: 1e9, y: 0, z: 1e9 };

export class EntityManager {
  private readonly entities = new Map<string, EntityRecord>();
  private readonly bySession = new Map<string, Set<string>>();
  private readonly startedAt = performance.now();

  constructor(private readonly host: EntityHost) {}

  get size(): number {
    return this.entities.size;
  }

  get(id: string): EntityRecord | undefined {
    return this.entities.get(id);
  }

  private full(e: EntityRecord): EntityUpdateFields {
    const f: EntityUpdateFields = { x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, ry: e.ry };
    if (e.clip) {
      f.clip = e.clip;
      f.clipT0 = e.clipT0;
      f.once = e.once;
    }
    if (e.sm) f.sm = e.sm;
    if (Object.keys(e.state).length) f.state = e.state;
    return f;
  }

  register(sessionId: string, domain: DomainId, items: { id: string; kind: string; x: number; y: number; z: number }[]): void {
    const to = [sessionId];
    for (const item of items) {
      let e = this.entities.get(item.id);
      if (e && e.domain !== domain) continue;
      if (!e) {
        const kind = getKind(item.kind);
        const position = { x: item.x, y: item.y, z: item.z };
        e = {
          id: item.id,
          kind: item.kind,
          domain,
          registrants: new Set(),
          x: item.x,
          y: item.y,
          z: item.z,
          vx: 0,
          vy: 0,
          vz: 0,
          ry: 0,
          clip: undefined,
          clipT0: 0,
          once: false,
          sm: undefined,
          state: {},
          runner: kind?.sm ? new StateMachineRunner(kind.sm, { current: position }, { current: null }) : null,
          position,
          dirty: {},
          hasDirty: false,
        };
        this.entities.set(item.id, e);
      }
      e.registrants.add(sessionId);
      let mine = this.bySession.get(sessionId);
      if (!mine) this.bySession.set(sessionId, (mine = new Set()));
      mine.add(item.id);
      this.host.sendMany(to, { t: "entity:update", id: e.id, ...this.full(e) });
    }
  }

  unregister(sessionId: string, ids: string[]): void {
    const mine = this.bySession.get(sessionId);
    for (const id of ids) {
      mine?.delete(id);
      const e = this.entities.get(id);
      if (!e) continue;
      e.registrants.delete(sessionId);
      if (e.registrants.size === 0) {
        e.runner?.dispose();
        this.entities.delete(id);
      }
    }
    if (mine && mine.size === 0) this.bySession.delete(sessionId);
  }

  removeSession(sessionId: string): void {
    const mine = this.bySession.get(sessionId);
    if (!mine) return;
    this.unregister(sessionId, [...mine]);
  }

  /** A client interacted. Mouse actions become blackboard flags for the
   *  machine (its own triggers decide, using the nearest player's distance);
   *  "door:<i>" toggles replicated state generically. */
  interact(sessionId: string, id: string, action: string, players: PlayerView[]): void {
    const e = this.entities.get(id);
    if (!e || !e.registrants.has(sessionId)) return;
    const from = players.find((p) => p.id === sessionId);
    if (from) {
      const dx = from.x - e.x;
      const dz = from.z - e.z;
      if (dx * dx + dz * dz > INTERACT_REACH_SQ) return; // too far to touch it
    }
    if (action === "mouse-left-click") {
      e.runner?.raise("__mouse_left_click");
      return;
    }
    const door = /^door:(\d+)$/.exec(action);
    if (door) {
      const idx = Number(door[1]);
      const doors = Array.isArray(e.state.doors) ? [...(e.state.doors as boolean[])] : [];
      doors[idx] = !doors[idx];
      e.state = { ...e.state, doors };
      e.dirty.state = e.state;
      e.hasDirty = true;
      this.flush(e);
    }
  }

  // ── the tick ─────────────────────────────────────────────────────────────

  tick(now = Date.now()): void {
    const dt = TICK_MS / 1000;
    const elapsed = (performance.now() - this.startedAt) / 1000;
    const playersByDomain = new Map<DomainId, PlayerView[]>();
    const playersOf = (domain: DomainId): PlayerView[] => {
      let list = playersByDomain.get(domain);
      if (!list) {
        list = [];
        for (const p of this.host.playersIn(domain)) {
          const age = Math.min((now - p.lastMoveAt) / 1000, MAX_PLAYER_EXTRAPOLATION_S);
          list.push({ ...p, x: p.x + p.vx * age, z: p.z + p.vz * age });
        }
        playersByDomain.set(domain, list);
      }
      return list;
    };

    for (const e of this.entities.values()) {
      const r = e.runner;
      if (!r) continue;
      const { pos, distSq } = nearestPlayer(e, playersOf(e.domain));
      // The runner reads its position through `position` — keep it current.
      e.position.x = e.x;
      e.position.y = e.y;
      e.position.z = e.z;
      r.tick(elapsed, dt, pos, distSq);

      // ── outputs → simulated fields ──
      const bb = r.blackboard;
      const vx = bb.__vel_x ?? 0;
      const vz = bb.__vel_z ?? 0;
      const vy = bb.__vel_y ?? 0;
      const ry = bb.__yaw ?? e.ry;
      let nx = e.x + vx * dt;
      let nz = e.z + vz * dt;
      // Blocked by a player? Then don't take the step (slide is overkill here).
      if ((vx !== 0 || vz !== 0) && distSq < 25) {
        const dx = pos.x - nx;
        const dz = pos.z - nz;
        if (dx * dx + dz * dz < PLAYER_BLOCK_DIST * PLAYER_BLOCK_DIST) {
          nx = e.x;
          nz = e.z;
        }
      }
      e.x = nx;
      e.z = nz;
      if (vy !== 0) e.y += vy * dt;

      if (vx !== e.vx || vz !== e.vz || vy !== e.vy) {
        e.vx = vx;
        e.vz = vz;
        e.vy = vy;
        e.dirty.vx = vx;
        e.dirty.vz = vz;
        e.dirty.vy = vy;
        e.dirty.x = e.x;
        e.dirty.y = e.y;
        e.dirty.z = e.z;
        e.hasDirty = true;
      } else if (vx !== 0 || vz !== 0 || vy !== 0) {
        // Moving at a steady velocity: re-anchor position each tick so
        // extrapolation on the client never drifts (cheap: it's the same
        // record either way).
        e.dirty.x = e.x;
        e.dirty.y = e.y;
        e.dirty.z = e.z;
        e.hasDirty = true;
      }
      if (Math.abs(ry - e.ry) > 1e-3) {
        e.ry = ry;
        e.dirty.ry = ry;
        e.hasDirty = true;
      }
      if (r.animationControl.dirty) {
        r.animationControl.dirty = false;
        const cmd = r.animationControl.pendingCommand;
        if (cmd && cmd.clipName !== e.clip) {
          e.clip = cmd.clipName;
          e.clipT0 = now;
          e.once = cmd.loop === 2200; // LOOP_ONCE
          e.dirty.clip = e.clip;
          e.dirty.clipT0 = e.clipT0;
          e.dirty.once = e.once;
          e.hasDirty = true;
        }
      }
      if (r.currentStateId !== e.sm) {
        e.sm = r.currentStateId;
        e.dirty.sm = e.sm;
        e.hasDirty = true;
      }
      if (e.hasDirty) this.flush(e);
    }
  }

  /** Interactions need extrapolated players too — the transport passes them. */
  playersFor(domain: DomainId): PlayerView[] {
    const now = Date.now();
    const list: PlayerView[] = [];
    for (const p of this.host.playersIn(domain)) {
      const age = Math.min((now - p.lastMoveAt) / 1000, MAX_PLAYER_EXTRAPOLATION_S);
      list.push({ ...p, x: p.x + p.vx * age, z: p.z + p.vz * age });
    }
    return list;
  }

  private flush(e: EntityRecord): void {
    if (!e.hasDirty) return;
    this.host.sendMany(e.registrants, { t: "entity:update", id: e.id, ...e.dirty });
    e.dirty = {};
    e.hasDirty = false;
  }
}
