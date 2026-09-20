import type { AnimationState } from "../objects/actors/state/animation";

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
 *   server → init    {id, color, spawn, domain, players[], serverTime, data}
 *                                                 also re-sent after a `domain` switch
 *   server → join    {player}                     to the rest of the domain
 *   both   → move    {id?, x,y,z, vx,vy,vz, ry}   an INTENT CHANGE (velocity/facing/stop/
 *                                                 drift), never per-frame; client omits `id`
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
 * Coordinates: players = capsule CENTER, entities = FEET; `ry` = three.js rotation.y.
 */

export type DomainId = "home" | "glitch-city";
export const DOMAIN_IDS: readonly DomainId[] = ["home", "glitch-city"];
export const isDomainId = (v: unknown): v is DomainId =>
  typeof v === "string" && (DOMAIN_IDS as readonly string[]).includes(v);

/** Presence of one session as every client sees it. */
export interface PlayerSnapshot {
  id: string;
  color: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ry: number;
}

/** The movement payload shared by both directions of `move`. */
export interface MoveIntent {
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

/** Serialized cap on one blob; a patch that would exceed it is rejected on both sides. */
export const PLAYER_DATA_MAX_BYTES = 64 * 1024;

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

export type ClientMessage =
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
}

export interface JoinMessage {
  t: "join";
  player: PlayerSnapshot;
}

export interface ServerMoveMessage extends MoveIntent {
  t: "move";
  id: string;
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

export type ServerMessage =
  | InitMessage
  | JoinMessage
  | ServerMoveMessage
  | LeaveMessage
  | PongMessage
  | DataMessage
  | EntityUpdateMessage;
