import { loadPlayer, savePlayerData, type PlayerData } from "../data/players.js";
import { EntityManager, type PlayerView } from "./entities/manager.js";
import type { PhysicsWorld } from "./physics/world.js";
import type { DomainId, MoveIntent, PlayerSnapshot, ServerMessage } from "../protocol.js";

/**
 * THE GAME STATE, transport-agnostic: the transport calls these methods and
 * hands in an `Outbox`. The Outbox is the ONLY abstraction (so the transport
 * could be swapped for e.g. Colyseus) — do not widen it.
 *
 * WRITE POLICY — never on the tick: on disconnect if dirty, otherwise at most
 * once per SAVE_INTERVAL_MS per player if dirty. Two tabs on one identity share
 * a row: last write wins.
 *
 * Domains are ROOMS: every broadcast is scoped to one; a domain change is a
 * leave + a join, never a filter.
 */

export interface Session extends PlayerSnapshot {
  /** NOT broadcast. */
  identity: string;
  domain: DomainId;
  /** For future authority / anti-teleport checks. */
  lastMoveAt: number;
  /** Mutate via setPlayerData/updatePlayerData so it is marked dirty. */
  data: PlayerData;
  dataDirty: boolean;
  dataSavedAt: number;
}

export interface Outbox {
  send(sessionId: string, msg: ServerMessage): void;
  sendMany(sessionIds: Iterable<string>, msg: ServerMessage, exceptSessionId?: string): void;
}

const GOLDEN_ANGLE_DEG = 137.508;
export const SAVE_INTERVAL_MS = 30_000;
const SPAWN_RING_RADIUS = 3;

const hslToHex = (h: number, s: number, l: number): string => {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

const snapshotOf = (s: Session): PlayerSnapshot => ({
  id: s.id,
  color: s.color,
  x: s.x,
  y: s.y,
  z: s.z,
  vx: s.vx,
  vy: s.vy,
  vz: s.vz,
  ry: s.ry,
});

export class World {
  private readonly sessions = new Map<string, Session>();
  private readonly rooms = new Map<DomainId, Set<string>>();
  /** Monotonic; drives color and spawn-slot assignment. */
  private joinCount = 0;
  readonly entities: EntityManager;

  constructor(private readonly out: Outbox, physics: PhysicsWorld | null = null) {
    this.entities = new EntityManager(
      {
        playersIn: (domain) => this.playerViews(domain),
        sendMany: (ids, msg) => this.out.sendMany(ids, msg),
      },
      physics,
    );
  }

  private *playerViews(domain: DomainId): Iterable<PlayerView> {
    for (const id of this.room(domain)) {
      const s = this.sessions.get(id);
      if (s) yield { id: s.id, domain: s.domain, x: s.x, y: s.y, z: s.z, vx: s.vx, vz: s.vz, lastMoveAt: s.lastMoveAt };
    }
  }

  tick(now = Date.now()): void {
    this.entities.tick(now);
  }

  private room(domain: DomainId): Set<string> {
    let r = this.rooms.get(domain);
    if (!r) this.rooms.set(domain, (r = new Set()));
    return r;
  }

  private roster(domain: DomainId, except: string): PlayerSnapshot[] {
    const list: PlayerSnapshot[] = [];
    for (const id of this.room(domain)) {
      if (id === except) continue;
      const s = this.sessions.get(id);
      if (s) list.push(snapshotOf(s));
    }
    return list;
  }

  private enterRoom(s: Session, spawn: { x: number; z: number }): void {
    const room = this.room(s.domain);
    room.add(s.id);
    this.out.send(s.id, {
      t: "init",
      id: s.id,
      color: s.color,
      spawn,
      domain: s.domain,
      players: this.roster(s.domain, s.id),
      serverTime: Date.now(),
      data: s.data,
    });
    this.out.sendMany(room, { t: "join", player: snapshotOf(s) }, s.id);
  }

  private leaveRoom(s: Session): void {
    const room = this.room(s.domain);
    room.delete(s.id);
    this.out.sendMany(room, { t: "leave", id: s.id });
  }

  /** Golden-angle ring so simultaneous joiners never stack. */
  private nextSpawn(): { x: number; z: number } {
    const a = (this.joinCount * GOLDEN_ANGLE_DEG * Math.PI) / 180;
    const r = SPAWN_RING_RADIUS * (1 + (this.joinCount % 3) * 0.5);
    return { x: Math.round(Math.cos(a) * r * 100) / 100, z: Math.round(Math.sin(a) * r * 100) / 100 };
  }

  addSession(id: string, identity: string, domain: DomainId): Session {
    const spawn = this.nextSpawn();
    const record = loadPlayer(identity);
    const s: Session = {
      id,
      identity,
      domain,
      color: hslToHex((this.joinCount * GOLDEN_ANGLE_DEG) % 360, 70, 55),
      x: spawn.x,
      y: 0,
      z: spawn.z,
      vx: 0,
      vy: 0,
      vz: 0,
      ry: 0,
      lastMoveAt: Date.now(),
      data: record.data,
      dataDirty: false,
      dataSavedAt: Date.now(),
    };
    this.joinCount++;
    this.sessions.set(id, s);
    this.enterRoom(s, spawn);
    return s;
  }

  removeSession(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    this.entities.removeSession(id);
    this.leaveRoom(s);
    if (s.dataDirty) this.persist(s);
  }

  private persist(s: Session): void {
    savePlayerData(s.identity, s.data);
    s.dataDirty = false;
    s.dataSavedAt = Date.now();
  }

  setPlayerData(id: string, data: PlayerData): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.data = data;
    s.dataDirty = true;
  }

  updatePlayerData(id: string, patch: PlayerData): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.data = { ...s.data, ...patch };
    s.dataDirty = true;
  }

  /** Call from a coarse timer, never from a tick. */
  flushDirty(now = Date.now()): number {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.dataDirty && now - s.dataSavedAt >= SAVE_INTERVAL_MS) {
        this.persist(s);
        n++;
      }
    }
    return n;
  }

  /** Shutdown: ignores the interval. */
  saveAll(): number {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.dataDirty) {
        this.persist(s);
        n++;
      }
    }
    return n;
  }

  /** NOT authoritative (yet): the claimed intent is relayed as-is. Authority would
   *  slot in here (validate against lastMoveAt/speed, relay the corrected state). */
  move(id: string, m: MoveIntent): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.x = m.x;
    s.y = m.y;
    s.z = m.z;
    s.vx = m.vx;
    s.vy = m.vy;
    s.vz = m.vz;
    s.ry = m.ry;
    s.lastMoveAt = Date.now();
    this.out.sendMany(this.room(s.domain), { t: "move", id, ...m }, id);
  }

  changeDomain(id: string, domain: DomainId): void {
    const s = this.sessions.get(id);
    if (!s || s.domain === domain) return;
    this.entities.removeSession(id);
    this.leaveRoom(s);
    s.domain = domain;
    s.vx = s.vy = s.vz = 0;
    this.enterRoom(s, this.nextSpawn());
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  get size(): number {
    return this.sessions.size;
  }
}
