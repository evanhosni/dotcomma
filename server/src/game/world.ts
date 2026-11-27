/**
 * Sessions (ephemeral presence), rooms (one per domain — every broadcast is room-scoped,
 * a domain change is leave + join), entities and persistence. Transport-agnostic: the
 * `Outbox` is the ONLY abstraction, kept thin so the transport could be swapped.
 */
import type { DomainId, EntityRegisterItem, HostStep, MoveIntent, PlayerData, PlayerSnapshot, ShootMessage, ShotHit, Vec3Tuple, Wound } from "../../../src/net/protocol/types";
import { PLAYER_HEALTH } from "../../../src/player/spec";
import { CORPSE_SECONDS, MAX_WOUNDS } from "../../../src/objects/actors/wounds/constants";
import { weaponOf } from "../../../src/weapons/spec";
import type { WeaponSpec } from "../../../src/weapons/spec";
import { mavImpactOf } from "../../../src/objects/actors/mav-unit/spec";
import { PLAYER_CLIPS } from "../../../src/player/constants";
import { EntityManager } from "./entities/EntityManager.js";
import type { PlayerView } from "./entities/types.js";
import { PlayerPersistence } from "./PlayerPersistence.js";
import { PHYSICS_DOMAIN } from "./physics/constants.js";
import type { PhysicsWorld } from "./physics/physicsWorld.js";
import type { Session, Outbox } from "./types";

const GOLDEN_ANGLE_DEG = 137.508;
const SPAWN_RING_RADIUS = 3;
/** Open manholes and doors kept per domain: a client spamming forged ids stops opening more here. */
const MAX_OPEN_TUNNELS = 20000;
/** NPCs gone for good (taken as hosts, or dead and lain their time), kept per domain: past it, one still
 *  goes but is forgotten. */
const MAX_RETIRED = 100000;
/** A shot may come this much faster than its weapon's rate (the client's clock and the network jitter). */
const FIRE_RATE_SLACK = 0.8;
/** A blast is sent where its rocket went off, after a flight of any length: two can come much closer
 *  together than they were fired. */
const BLAST_RATE_SLACK = 0.25;
/** A shot starts within this of the shooter's reported position (its eye, a step it has taken since). */
const SHOT_ORIGIN_REACH = 6;
/** A hit on a player lies within this of its reported position. */
const PLAYER_HIT_REACH = 4;
/** A hit on a player's corpse lies within this of where it died (u: a thrown, shoved body slides). */
const CORPSE_HIT_REACH = 25;
/** A bullet's stop lies at most this past the weapon's range (u: the hit test's rounding). */
const END_SLACK = 1;
/** A body a blast burst lies within this past its radius (u: a body's origin is not its nearest point). */
const BLAST_SLACK = 1.5;

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
  st: s.lastMoveAt,
  x: s.x,
  y: s.y,
  z: s.z,
  vx: s.vx,
  vy: s.vy,
  vz: s.vz,
  ry: s.ry,
  hy: s.hy,
  hp: s.hp,
  clip: s.clip,
  cs: s.cs,
  loop: s.loop,
  fm: s.fm,
  mh: s.mh,
  md: s.md,
  wp: s.wp,
  health: s.health,
  wounds: s.wounds,
});

const distance = (a: Vec3Tuple, b: { x: number; y: number; z: number } | Vec3Tuple): number =>
  Array.isArray(b) ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : Math.hypot(a[0] - b.x, a[1] - b.y, a[2] - b.z);

export class World {
  private readonly sessions = new Map<string, Session>();
  private readonly rooms = new Map<DomainId, Set<string>>();
  /** Drives color and spawn-slot assignment. */
  private joinCount = 0;
  private readonly entities: EntityManager;
  private readonly persistence = new PlayerPersistence();
  /** The open manholes and doors, per domain (TunnelToggleMessage): the server's, so its NPCs fall into
   *  the open manholes every player sees. Not persisted: a restart closes them. */
  private readonly openTunnels = new Map<DomainId, Set<string>>();
  /** The intro's possessions, per domain: each claimed NPC → the session whose MAV Unit is taking it. */
  private readonly hostClaims = new Map<DomainId, Map<string, string>>();
  /** NPCs gone for good, per domain (taken as hosts, dead and lain their time): never simulated or drawn
   *  again. Not persisted: a restart brings them back. */
  private readonly retired = new Map<DomainId, Set<string>>();
  /** Dead players' corpses (each client draws its own; the server only checks shots at them): id → where
   *  and until when (ms) it lies. */
  private readonly corpses = new Map<string, { domain: DomainId; at: Vec3Tuple; until: number }>();
  private corpseCount = 0;

  constructor(private readonly out: Outbox, private readonly physics: PhysicsWorld | null = null) {
    this.entities = new EntityManager(
      {
        playersIn: (domain) => this.playerViews(domain),
        sendMany: (ids, msg) => this.out.sendMany(ids, msg),
        isRetired: (domain, id) => this.retiredIn(domain).has(id),
        onCorpseGone: (domain, id) => this.retireActor(domain, id),
      },
      physics,
    );
  }

  get size(): number {
    return this.sessions.size;
  }

  tick(now = Date.now()): void {
    this.entities.tick(now);
  }

  addSession(id: string, identity: string, domain: DomainId): Session {
    const spawn = this.nextSpawn();
    this.persistence.attach(identity);
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
      hy: 0,
      hp: 0,
      clip: PLAYER_CLIPS.idle,
      cs: 1,
      loop: "repeat",
      fm: "mav",
      mh: "",
      md: 0,
      wp: "",
      health: PLAYER_HEALTH,
      wounds: [],
      dead: false,
      lastShotAt: 0,
      lastMoveAt: Date.now(),
    };
    this.joinCount++;
    this.sessions.set(id, s);
    this.enterRoom(s, spawn);
    return s;
  }

  removeSession(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.releaseHosts(s);
    this.sessions.delete(id);
    this.entities.removeSession(id);
    this.leaveRoom(s);
    this.persistence.detach(s.identity);
  }

  /** NOT authoritative yet: the intent is relayed as claimed. Validation against
   *  lastMoveAt/speed would slot in here. Stamped with the server clock (strictly increasing: two moves
   *  in one millisecond must not share a stamp, which receivers treat as one snapshot replacing another). */
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
    s.hy = m.hy;
    s.hp = m.hp;
    s.clip = m.clip;
    s.cs = m.cs;
    s.loop = m.loop;
    s.fm = m.fm;
    s.mh = m.mh;
    s.md = m.md;
    s.wp = m.wp;
    s.lastMoveAt = Math.max(Date.now(), s.lastMoveAt + 1);
    this.out.sendMany(this.room(s.domain), { t: "move", id, st: s.lastMoveAt, ...m }, id);
  }

  /** Tells `targetId` it was clicked: only a player in the clicker's domain, never the clicker itself. */
  clickPlayer(id: string, targetId: string): void {
    const s = this.sessions.get(id);
    const target = this.sessions.get(targetId);
    if (!s || !target || target === s || target.domain !== s.domain) return;
    this.out.send(targetId, { t: "player:clicked", by: id });
  }

  changeDomain(id: string, domain: DomainId): void {
    const s = this.sessions.get(id);
    if (!s || s.domain === domain) return;
    this.releaseHosts(s);
    this.entities.removeSession(id);
    this.leaveRoom(s);
    s.domain = domain;
    s.vx = s.vy = s.vz = 0;
    this.enterRoom(s, this.nextSpawn());
  }

  /** Merge a client's patch into its identity's blob and echo it to every session of that identity. */
  patchPlayerData(id: string, patch: unknown): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const merged = this.persistence.patch(s.identity, patch);
    if (!merged) return;
    this.broadcastPlayerData(s.identity, merged);
  }

  registerEntities(id: string, items: EntityRegisterItem[]): void {
    const s = this.sessions.get(id);
    if (s) this.entities.register(id, s.domain, items);
  }

  unregisterEntities(id: string, entityIds: string[]): void {
    this.entities.unregister(id, entityIds);
  }

  interactWithEntity(id: string, entityId: string, action: string): void {
    if (this.sessions.has(id)) this.entities.interact(id, entityId, action);
  }

  /** Flips a manhole's or door's open state in the player's domain and tells everyone there. The id's
   *  shape is checked (server/src/transport/index.ts), not that the player stands by it: a forged id opens nothing
   *  anyone can reach. */
  toggleTunnel(id: string, tunnelId: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const open = this.tunnelsOpenIn(s.domain);
    const next = !open.has(tunnelId);
    if (next && open.size >= MAX_OPEN_TUNNELS) return;
    if (next) open.add(tunnelId);
    else open.delete(tunnelId);
    if (s.domain === PHYSICS_DOMAIN) this.physics?.setTunnelOpen(tunnelId, next);
    this.out.sendMany(this.room(s.domain), { t: "tunnel:state", id: tunnelId, open: next });
  }

  /** One step of the intro's possession (HostMessage). A claim is answered; every other step counts only
   *  from the session holding the claim. A session holds one claim at a time. */
  host(id: string, entityId: string, step: HostStep): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const claims = this.hostClaimsIn(s.domain);
    if (step === "claim") {
      const ok = !this.retiredIn(s.domain).has(entityId) && !this.entities.isDead(entityId) && (claims.get(entityId) ?? id) === id;
      if (ok && claims.get(entityId) !== id) this.claimHostFor(s, entityId);
      this.out.send(id, { t: "host:claim", id: entityId, ok });
      return;
    }
    // A step with no claim on record claims the host now (a server restart between claim and impact lost it).
    if (!claims.has(entityId) && !this.retiredIn(s.domain).has(entityId) && !this.entities.isDead(entityId) && step !== "release") this.claimHostFor(s, entityId);
    if (claims.get(entityId) !== id) return;
    switch (step) {
      case "impact":
        this.entities.setRagdoll(entityId, true, mavImpactOf(entityId));
        return;
      case "wake":
        this.entities.setRagdoll(entityId, false, undefined, true);
        return;
      case "release":
        claims.delete(entityId);
        this.entities.setRagdoll(entityId, false);
        return;
      case "possess": {
        claims.delete(entityId);
        this.entities.retire(entityId);
        this.retireActor(s.domain, entityId);
        // A fresh host: whole, unhurt.
        this.setHealth(s, PLAYER_HEALTH, []);
        s.dead = false;
        return;
      }
    }
  }

  /** The session's one claim moves to `entityId`. */
  private claimHostFor(s: Session, entityId: string): void {
    this.releaseHosts(s);
    this.hostClaimsIn(s.domain).set(entityId, s.id);
  }

  /** A leaving session's claim lets its NPC go: back up from limp, free to be claimed again. */
  private releaseHosts(s: Session): void {
    const claims = this.hostClaimsIn(s.domain);
    for (const [entityId, sessionId] of claims) {
      if (sessionId !== s.id) continue;
      claims.delete(entityId);
      this.entities.setRagdoll(entityId, false);
    }
  }

  private hostClaimsIn(domain: DomainId): Map<string, string> {
    let claims = this.hostClaims.get(domain);
    if (!claims) this.hostClaims.set(domain, (claims = new Map()));
    return claims;
  }

  /** An NPC gone for good: every player in the domain is told, and later ones are by `init`. */
  private retireActor(domain: DomainId, id: string): void {
    const retired = this.retiredIn(domain);
    if (retired.size < MAX_RETIRED) retired.add(id);
    this.out.sendMany(this.room(domain), { t: "actor:retired", id });
  }

  private retiredIn(domain: DomainId): Set<string> {
    let retired = this.retired.get(domain);
    if (!retired) this.retired.set(domain, (retired = new Set()));
    return retired;
  }

  /** A shot (ShootMessage). The shooter's own hit test is trusted, within limits: it must hold the weapon
   *  (its last move's `wp`) in a live host, fire no faster than the weapon allows, from where it stands, and
   *  hit within the weapon's reach what stands (or lies) where it says, each body once: the bullet goes
   *  through every one. Everyone else in the domain sees it, with the hits that landed. */
  shoot(id: string, m: ShootMessage, now = Date.now()): void {
    const s = this.sessions.get(id);
    const weapon = weaponOf(m.weapon);
    if (!s || !weapon || s.dead || s.fm !== "host" || s.wp !== weapon.id) return;
    if (now - s.lastShotAt < weapon.fireInterval * 1000 * (weapon.attack === "blast" ? BLAST_RATE_SLACK : FIRE_RATE_SLACK)) return;
    // A blast's `o` is the shooter's eye as it went off: it may have walked since it fired.
    if (distance(m.o, s) > SHOT_ORIGIN_REACH) return;
    const end = m.end && distance(m.o, m.end.at) <= weapon.range + (weapon.blastRadius ?? 0) + END_SLACK ? m.end : null;
    // A blast is where it exploded, or nothing.
    if (weapon.attack === "blast" && !end) return;
    s.lastShotAt = now;
    const landed: ShotHit[] = [];
    const seen = new Set<string>();
    for (const raw of m.hits) {
      const hit = strikeOf(raw, weapon);
      const key = hit.kind + ":" + hit.id;
      if (seen.has(key) || distance(m.o, hit.at) > weapon.range + (weapon.blastRadius ?? 0)) continue;
      if (weapon.attack === "blast" && distance(end!.at, hit.at) > weapon.blastRadius! + BLAST_SLACK) continue;
      seen.add(key);
      if (this.applyHit(s, hit, weapon, m.d, hit.gib ? end!.at : undefined, now)) landed.push(hit);
    }
    this.out.sendMany(this.room(s.domain), { t: "shot", id, weapon: weapon.id, o: m.o, d: m.d, hits: landed, end }, id);
  }

  /** One body a shot went through; false when it cannot be that body (another domain, not where it is said
   *  to be, already gone). */
  private applyHit(s: Session, hit: ShotHit, weapon: WeaponSpec, dir: Vec3Tuple, gib: Vec3Tuple | undefined, now: number): boolean {
    if (hit.kind === "npc") return this.entities.shoot(hit.id, s.domain, weapon, { wounds: hit.wounds, cuts: hit.cuts, gib }, dir, hit.at, now);
    if (hit.kind === "corpse") {
      const corpse = this.corpses.get(hit.id);
      return !!corpse && corpse.until > now && corpse.domain === s.domain && distance(hit.at, corpse.at) <= CORPSE_HIT_REACH;
    }
    const target = this.sessions.get(hit.id);
    if (!target || target === s || target.domain !== s.domain || target.dead || target.fm !== "host" || distance(hit.at, target) > PLAYER_HIT_REACH) return false;
    this.hurtPlayer(target, weapon.damage, hit, dir, gib, now);
    return true;
  }

  /** A player is hit: its wounds kept, its health taken; at 0 its host is a corpse (everyone told), sliced or
   *  burst by the blow that killed it. */
  private hurtPlayer(s: Session, damage: number, hit: ShotHit, dir: Vec3Tuple, gib: Vec3Tuple | undefined, now: number): void {
    this.setHealth(s, Math.max(0, s.health - damage), [...s.wounds, ...hit.wounds].slice(-MAX_WOUNDS));
    if (s.health > 0) return;
    s.dead = true;
    for (const [key, c] of this.corpses) if (c.until <= now) this.corpses.delete(key);
    const corpse = `${s.id}~${++this.corpseCount}`;
    this.corpses.set(corpse, { domain: s.domain, at: [s.x, s.y, s.z], until: now + CORPSE_SECONDS * 1000 });
    this.out.sendMany(this.room(s.domain), { t: "player:died", id: s.id, d: dir, corpse, ...(hit.cuts ? { cuts: hit.cuts } : {}), ...(gib ? { gib } : {}) });
  }

  private setHealth(s: Session, health: number, wounds: Wound[]): void {
    s.health = health;
    s.wounds = wounds;
    this.out.sendMany(this.room(s.domain), { t: "player:hurt", id: s.id, health, wounds });
  }

  private tunnelsOpenIn(domain: DomainId): Set<string> {
    let open = this.openTunnels.get(domain);
    if (!open) this.openTunnels.set(domain, (open = new Set()));
    return open;
  }

  /** Call from a coarse timer, never from a tick. */
  flushDirty(now = Date.now()): number {
    return this.persistence.flushDirty(now);
  }

  saveAll(): number {
    return this.persistence.saveAll();
  }

  private *playerViews(domain: DomainId): Iterable<PlayerView> {
    for (const id of this.room(domain)) {
      const s = this.sessions.get(id);
      if (s) yield { id: s.id, domain: s.domain, form: s.fm, x: s.x, y: s.y, z: s.z, vx: s.vx, vz: s.vz, lastMoveAt: s.lastMoveAt };
    }
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
      data: this.persistence.get(s.identity)?.data ?? {},
      tunnelsOpen: [...this.tunnelsOpenIn(s.domain)],
      retired: [...this.retiredIn(s.domain)],
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

  private broadcastPlayerData(identity: string, data: PlayerData): void {
    for (const other of this.sessions.values()) {
      if (other.identity === identity) this.out.send(other.id, { t: "data", data });
    }
  }
}

/** A hit as its weapon can strike: only a blade cuts, only a blast bursts (every body it reaches). */
const strikeOf = (hit: ShotHit, weapon: WeaponSpec): ShotHit => {
  const { cuts, gib, ...rest } = hit;
  if (weapon.attack === "blade" && cuts) return { ...rest, cuts };
  if (weapon.attack === "blast") return { ...rest, gib: true };
  return rest;
};