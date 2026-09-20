/**
 * WIRE PROTOCOL — JSON text frames, one message per frame, discriminated on `t`.
 *
 * DUPLICATED in server/src/protocol.ts (CRA's ModuleScopePlugin forbids importing
 * across src/). Change both or neither; the server file is canonical.
 *
 * IDS — two, never conflated:
 *   `identity`  client-generated uuid kept in localStorage; names the PERSISTED
 *               player. Sent once in `hello`, never broadcast.
 *   `id`        server-assigned SESSION id; names a presence, carried by every
 *               join/move/leave. Two tabs share an identity but are two sessions.
 *
 * FLOW.
 *   client  → hello   {identity, domain}          first message, exactly once
 *   server  → init    {id, color, spawn, domain, players[], serverTime, data}
 *                                                 your session, the domain roster, your
 *                                                 persisted blob. Re-sent after `domain`.
 *   server  → join    {player}                    to the others in the domain
 *   both    → move    {id?, x,y,z, vx,vy,vz, ry}  an INTENT CHANGE (velocity/facing change,
 *                                                 stop with v = 0, drift correction) — never
 *                                                 a per-frame position. Client → server
 *                                                 omits `id`.
 *   client  → domain  {domain}                    leave(old) + join(new) + fresh `init`
 *   server  → leave   {id}
 *   client  → ping    {t0}                        liveness + clock sync (ws-level ping/pong
 *   server  → pong    {t0, serverTime}            is ALSO used, server-side only)
 *   client  → debug:setData {data}                DEV ONLY (server DEBUG_DATA_WRITES=1)
 *
 * ENTITY SYNC — server authority (see game/entities/manager.ts):
 *   client  → entity:register   {entities:[{id, kind, x, y, z}]}
 *                                                 "I am rendering these" (kind = actor
 *                                                 descriptor id). Answered with the FULL
 *                                                 record as an entity:update.
 *   client  → entity:unregister {ids}             last one out forgets it
 *   client  → entity:interact   {id, action}      "mouse-left-click" (raised on the machine's
 *                                                 blackboard) or "door:<i>" (toggles state)
 *   server  → entity:update     {id, st?, x?,y?,z?, vx?,vy?,vz?, ry?, clip?, clipT0?, once?, sm?, state?}
 *                                                 changed fields only, ≤10Hz, to registrants
 *
 * Domains are the broadcast scope; nothing crosses one except the mover's re-init.
 * Coordinates: player capsule CENTER, world units; `ry` = yaw (three.js rotation.y).
 */

export type DomainId = "home" | "glitch-city";
export const DOMAIN_IDS: readonly DomainId[] = ["home", "glitch-city"];
export const isDomainId = (v: unknown): v is DomainId =>
  typeof v === "string" && (DOMAIN_IDS as readonly string[]).includes(v);

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

export interface MoveIntent {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ry: number;
}

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

/** Opaque: shape deliberately undefined, nothing may assume a key inside it. */
export type PlayerData = Record<string, unknown>;

export interface DebugSetDataMessage {
  t: "debug:setData";
  data: PlayerData;
}

export interface EntityRegisterItem {
  id: string;
  /** Actor descriptor id — selects the server-side simulation (kinds.ts). */
  kind: string;
  x: number;
  y: number;
  z: number;
}

/** Every field optional so an update carries only what changed. */
export interface EntityUpdateFields {
  /** Server time (ms) of the publishing tick; present whenever x/y/z are. Clients
   *  interpolate on this clock, never on arrival time. */
  st?: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  ry?: number;
  clip?: string;
  /** Server time (ms) the clip started. */
  clipT0?: number;
  /** Clip plays once and holds its last frame. */
  once?: boolean;
  /** Server-side state machine's current state id. */
  sm?: string;
  /** Replicated state blob (component-defined, e.g. door flags). */
  state?: Record<string, unknown>;
}

export interface EntityUpdateMessage extends EntityUpdateFields {
  t: "entity:update";
  id: string;
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
  | DebugSetDataMessage
  | EntityRegisterMessage
  | EntityUnregisterMessage
  | EntityInteractMessage;

// ── server → client ────────────────────────────────────────────────────────

export interface InitMessage {
  t: "init";
  id: string;
  color: string;
  /** Offset (x/z) from the domain's spawn point so simultaneous joiners don't stack. */
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

export type ServerMessage =
  | InitMessage
  | JoinMessage
  | ServerMoveMessage
  | LeaveMessage
  | PongMessage
  | EntityUpdateMessage;
