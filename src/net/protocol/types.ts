/**
 * WIRE PROTOCOL — JSON text frames discriminated on `t`. The one copy: the server
 * bundles this file from src/. Three-free, React-free — keep it so.
 *
 * TWO IDS: `identity` = the client's localStorage uuid, names the PERSISTED player,
 * sent once in `hello`, never broadcast. `id` = the SESSION id the server assigns per
 * connection, carried by every presence message. Two tabs share an identity but are
 * two sessions.
 *
 *   client → hello   {identity, domain}           exactly once, first
 *   server → init    {id, color, spawn, domain, players[], serverTime, data, tunnelsOpen, retired}
 *                                                 also re-sent after a `domain` switch
 *   server → join    {player}                     to the rest of the domain
 *   both   → move    {id?, st?, x,y,z, vx,vy,vz, ry, hy, hp, clip, cs, loop, fm, mh, md, wp}   ~10Hz while moving, plus every
 *                                                 start/stop/turn/relocation and every change of the
 *                                                 drawn pose (clip, head); the client omits `id` and
 *                                                 `st`, the server stamps `st` (its clock) on the relay
 *   client → host    {id, step}                   the intro's MAV Unit and its host NPC: claim → impact →
 *                                                 wake → possess (or release); only the claimer's steps count
 *   server → host:claim {id, ok}                  to the claimer: whether the host is its
 *   server → actor:retired {id}                   to the domain: that NPC is gone for good (a player now, or dead)
 *   client → shoot   {weapon, o, d, hits, end}     a shot from o along d (unit): every body it went through,
 *                                                 nearest first, and the solid surface that stopped it (the
 *                                                 shooter's own hit test, validated: rate, reach, the shooter alive)
 *   server → shot    {id, weapon, o, d, hits, end} to the rest of the domain: draw it (flash, blood, holes
 *                                                 in a player's corpse, the bullet hole where it stopped)
 *   server → player:hurt {id, health, wounds}      to the domain: a player's health and every wound it bears
 *   server → player:died {id, d, corpse}           to the domain, the victim included: its beeble is a corpse
 *                                                 (id `corpse`, thrown along d), its MAV Unit rescans from the sky
 *   client → player:click {id}                    a click on another player's beeble
 *   server → player:clicked {by}                  to the clicked player only (same domain)
 *   client → domain  {domain}                     leave old room + join new + fresh init
 *   server → leave   {id}
 *   client → ping    {t0} / server → pong {t0, serverTime}   liveness + clock sync
 *   client → data:patch {patch}                   shallow-merge into the persisted blob
 *   server → data      {data}                     the merged blob, to every session of
 *                                                 that identity
 *   client → entity:register   {entities:[{id, kind, x, y, z}]}   "I render these";
 *                                                 answered with the full record
 *   client → entity:unregister {ids}              last one out forgets the entity
 *   client → entity:interact   {id, action}       an INPUT ("mouse-<flag>" raised on the
 *                                                 server machine's blackboard, or "door:<i>")
 *   server → entity:update     {id, st?, x?,y?,z?, vx?,vy?,vz?, ry?, anim?, sm?, state?}
 *                                                 changed fields only, ≤10Hz, to registrants
 *
 * Domains are the broadcast scope; nothing crosses one except the mover's re-init.
 * Coordinates: players = capsule CENTER, entities = FEET; `ry` = three.js rotation.y (a player's: its BODY's).
 */
import type { AnimationState } from "../../animation/types";
import { DOMAIN_IDS, HOST_STEPS } from "./enums";

export type DomainId = (typeof DOMAIN_IDS)[number];

/** What a player is: its MAV Unit alone (the intro: falling, then screwing into its host), or the beeble
 *  host wearing it (player/PlayerBody.tsx). */
export type PlayerForm = "mav" | "host";

/** The intro's possession, step by step (HostMessage). */
export type HostStep = (typeof HOST_STEPS)[number];

/** [x, y, z] on the wire. */
export type Vec3Tuple = [number, number, number];

/** A bullet's hole in a body's surface, skinned as that surface is: at (x, y, z) in the model's BIND space,
 *  moved by bones `b` (their names) with weights `w` (the nearest vertex's skin), so it stays on the skin
 *  through every pose, ragdoll bend and fall; (nx, ny, nz) the skin's outward normal there, in the same space
 *  (the hole's fleshy rim lies along it); `r` its radius (u). */
export interface WoundHole {
  b: string[];
  w: number[];
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  r: number;
}

/** A bullet's way through a body: the hole it went in by and the one it came out of (null: it stayed in). The
 *  two are joined by a tunnel of flesh (objects/actors/wounds/). */
export interface Wound {
  entry: WoundHole;
  exit: WoundHole | null;
}

/** What a shot hit: an NPC entity, a player (session id) or a dead player's corpse (its PlayerDiedMessage
 *  `corpse`), where (world point: the blood), and the wounds it left, the entry and (when it passed through)
 *  the exit. */
export interface ShotHit {
  kind: "npc" | "player" | "corpse";
  id: string;
  at: Vec3Tuple;
  wounds: Wound[];
}

/** What a player's beeble shows beyond its position and facing (player/PlayerBody.tsx). */
export interface PlayerAvatar {
  /** The weapon in its hand (weapons/spec.ts id), "" none. */
  wp: string;
  /** Its form. A "mav" player's position is its MAV Unit's origin (objects/actors/mav-unit/spec.ts). */
  fm: PlayerForm;
  /** The NPC entity a "mav" player is screwing into ("" none), and how far in (0–1). */
  mh: string;
  md: number;
  /** Head yaw from the body and head pitch (+ = up) (radians). */
  hy: number;
  hp: number;
  /** The animation clip (player/constants.ts PLAYER_CLIPS), its speed and loop. */
  clip: string;
  cs: number;
  loop: PlayerClipLoop;
}

export type PlayerClipLoop = "repeat" | "once";

/** Presence of one session as every client sees it. */
export interface PlayerSnapshot extends PlayerAvatar {
  id: string;
  color: string;
  health: number;
  wounds: Wound[];
  /** Server time (ms) of this pose: its last move's stamp. */
  st: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ry: number;
}

/** The movement payload shared by both directions of `move`. */
export interface MoveIntent extends PlayerAvatar {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ry: number;
}

/** The persisted per-player blob. Shape still open: add named keys here as they
 *  exist; until then nothing may assume a key inside it. */
export type PlayerData = Record<string, unknown>;

// ── client → server ────────────────────────────────────────────────────────

export interface HelloMessage {
  t: "hello";
  identity: string;
  domain: DomainId;
}

export interface ClientMoveMessage extends MoveIntent {
  t: "move";
}

export interface DomainMessage {
  t: "domain";
  domain: DomainId;
}

export interface PingMessage {
  t: "ping";
  /** Client send time (ms), echoed back untouched. */
  t0: number;
}

export interface DataPatchMessage {
  t: "data:patch";
  patch: PlayerData;
}

export interface EntityRegisterItem {
  id: string;
  /** Actor descriptor id — selects the server-side simulation (actor catalog). */
  kind: string;
  x: number;
  y: number;
  z: number;
}

export interface EntityRegisterMessage {
  t: "entity:register";
  entities: EntityRegisterItem[];
}

export interface EntityUnregisterMessage {
  t: "entity:unregister";
  ids: string[];
}

export interface EntityInteractMessage {
  t: "entity:interact";
  id: string;
  action: string;
}

/** A click on a tunnel's manhole cover or door (objects/underground): the server owns every
 *  one's open state, per domain, so its NPCs fall into the same open manholes the players see. */
export interface TunnelToggleMessage {
  t: "tunnel:toggle";
  id: string;
}

/** The intro's possession of an NPC beeble (world/domains/overworld/intro/): the server reserves it for the
 *  claimer, ragdolls it on impact, stands it up on wake and retires it on possess. */
export interface HostMessage {
  t: "host";
  id: string;
  step: HostStep;
}

/** A shot (weapons/WeaponDriver.tsx). */
export interface ShootMessage {
  t: "shoot";
  weapon: string;
  o: Vec3Tuple;
  d: Vec3Tuple;
  /** Every body the bullet went through, nearest first (it stops only at a solid surface). */
  hits: ShotHit[];
  /** Where it stopped. */
  end: ShotImpact | null;
}

/** Where a bullet stopped on the world: the point and the surface's normal (its bullet hole). */
export interface ShotImpact {
  at: Vec3Tuple;
  n: Vec3Tuple;
}

/** A click on another player's beeble (net/players/RemotePlayers.tsx): relayed to that player only. */
export interface PlayerClickMessage {
  t: "player:click";
  id: string;
}

export type ClientMessage =
  | ShootMessage
  | HostMessage
  | PlayerClickMessage
  | TunnelToggleMessage
  | HelloMessage
  | ClientMoveMessage
  | DomainMessage
  | PingMessage
  | DataPatchMessage
  | EntityRegisterMessage
  | EntityUnregisterMessage
  | EntityInteractMessage;

// ── server → client ────────────────────────────────────────────────────────

export interface InitMessage {
  t: "init";
  id: string;
  color: string;
  /** Spawn OFFSET from the domain's spawn point so simultaneous joiners don't stack; the client owns height. */
  spawn: { x: number; z: number };
  domain: DomainId;
  players: PlayerSnapshot[];
  serverTime: number;
  data: PlayerData;
  /** The domain's open manholes and doors (TunnelToggleMessage). */
  tunnelsOpen: string[];
  /** The domain's NPCs gone for good (ActorRetiredMessage): never spawned again. */
  retired: string[];
}

/** The answer to a `host` claim, to the claimer only. */
export interface HostClaimMessage {
  t: "host:claim";
  id: string;
  ok: boolean;
}

/** An NPC is gone for good (became a player, or died and lay its time): to every player in the domain. */
export interface ActorRetiredMessage {
  t: "actor:retired";
  id: string;
}

/** Another player fired: drawn where its weapon is, blood from every body it went through (the hits the
 *  server accepted), a corpse's new holes, a bullet hole where it stopped. */
export interface ShotMessage {
  t: "shot";
  id: string;
  weapon: string;
  o: Vec3Tuple;
  d: Vec3Tuple;
  hits: ShotHit[];
  end: ShotImpact | null;
}

/** A player's health and wounds changed (a hit, or a fresh host: full health, no wounds). */
export interface PlayerHurtMessage {
  t: "player:hurt";
  id: string;
  health: number;
  wounds: Wound[];
}

/** A player's host died: its body falls as a corpse thrown along `d`; the player rescans for another. */
export interface PlayerDiedMessage {
  t: "player:died";
  id: string;
  d: Vec3Tuple;
  /** The corpse's id, unique in the server's run: shots at it name it (ShotHit kind "corpse"). */
  corpse: string;
}

/** A manhole or door of the domain changed: to every player in it, the toggler included. */
export interface TunnelStateMessage {
  t: "tunnel:state";
  id: string;
  open: boolean;
}

export interface JoinMessage {
  t: "join";
  player: PlayerSnapshot;
}

export interface ServerMoveMessage extends MoveIntent {
  t: "move";
  id: string;
  /** Server time (ms) the move was received: receivers play players back on the server clock, as
   *  entities (net/entities/utils.ts). Strictly increasing per player. */
  st: number;
}

export interface LeaveMessage {
  t: "leave";
  id: string;
}

export interface PongMessage {
  t: "pong";
  t0: number;
  serverTime: number;
}

export interface DataMessage {
  t: "data";
  data: PlayerData;
}

/** Every field optional: an update carries only what changed. */
export interface EntityUpdateFields {
  /** Server time (ms) of the publishing tick, present whenever x/y/z are — clients
   *  interpolate on this clock, never on arrival time. */
  st?: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  ry?: number;
  /** Whole animation-channel state with SERVER-time clocks, so a client can compute
   *  the exact clip time on its delayed render clock. */
  anim?: AnimationState;
  /** Server machine's state id (mirrored for state-keyed visuals). */
  sm?: string;
  /** Component-defined replicated blob (e.g. door flags). */
  state?: Record<string, unknown>;
}

export interface EntityUpdateMessage extends EntityUpdateFields {
  t: "entity:update";
  id: string;
}

/** You were clicked by session `by` (PlayerClickMessage). */
export interface PlayerClickedMessage {
  t: "player:clicked";
  by: string;
}

export type ServerMessage =
  | HostClaimMessage
  | ActorRetiredMessage
  | ShotMessage
  | PlayerHurtMessage
  | PlayerDiedMessage
  | PlayerClickedMessage
  | TunnelStateMessage
  | InitMessage
  | JoinMessage
  | ServerMoveMessage
  | LeaveMessage
  | PongMessage
  | DataMessage
  | EntityUpdateMessage;
