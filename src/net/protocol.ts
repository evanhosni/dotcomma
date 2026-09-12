import type { AnimationState } from "../objects/actors/state/animation";

/**
 * WIRE PROTOCOL — JSON text frames, one message per frame, discriminated on `t`.
 *
 * THE ONE COPY. The server imports this file straight from src/ (it is bundled
 * with esbuild and already imports the state machines, the height pipeline and
 * the actor catalog the same way); CRA only forbids the CLIENT importing
 * across src/, which never happens here. Three-free, React-free — keep it so.
 *
 * IDS. Two different ids, do not conflate them:
 *   - `identity`  — the anonymous uuid the CLIENT generates once and keeps in
 *                   localStorage. It names the PERSISTED player (players.id).
 *                   Sent once, in `hello`, never broadcast.
 *   - `id`        — the SESSION id the SERVER assigns per connection. It names
 *                   a presence in the world: every join/move/leave carries it.
 *                   Two tabs of one browser share an identity but are two
 *                   sessions, so they can both stand in the world.
 *
 * FLOW.
 *   client  → hello   {identity, domain}          first message, exactly once
 *   server  → init    {id, color, spawn, domain, players[], serverTime, data}
 *                                                 your session + everyone already in
 *                                                 your domain + YOUR persisted data
 *                                                 blob. ALSO re-sent after a `domain`
 *                                                 switch (new roster).
 *   server  → join    {player}                    to the others in the domain
 *   both    → move    {id?, x,y,z, vx,vy,vz, ry}  an INTENT CHANGE, not a per-frame
 *                                                 position: sent when velocity or
 *                                                 facing changes, on stop (v = 0),
 *                                                 and as an occasional drift
 *                                                 correction. Receivers extrapolate
 *                                                 pos + v·dt and smooth toward it.
 *                                                 Client → server omits `id`.
 *   client  → domain  {domain}                    world switch: a `leave` in the
 *                                                 old domain, a `join` in the new,
 *                                                 and a fresh `init` to the mover
 *   server  → leave   {id}                        to the others in that domain
 *   client  → ping    {t0}                        app-level liveness + clock sync
 *   server  → pong    {t0, serverTime}            (protocol-level ws ping/pong is
 *                                                 ALSO used, server-side only —
 *                                                 browsers cannot observe it)
 *
 * PLAYER DATA (persistence, see server/src/game/persistence.ts):
 *   client  → data:patch {patch}                  shallow-merge into YOUR persisted
 *                                                 blob (settings, progress). The
 *                                                 server validates size, merges,
 *                                                 marks dirty (saved per its write
 *                                                 policy) and answers…
 *   server  → data      {data}                    …the merged blob, to EVERY session
 *                                                 of that identity (a second tab
 *                                                 stays in sync).
 *
 * ENTITY SYNC — SERVER AUTHORITY (see server/src/game/entities/manager.ts):
 *   client  → entity:register   {entities:[{id, kind, x, y, z}]}
 *                                                 "I am rendering these" (kind = actor
 *                                                 descriptor id). The server creates the
 *                                                 record on first sight and, for kinds in
 *                                                 the actor catalog, runs the actor's own
 *                                                 state machine and moves its body.
 *                                                 Answered with the FULL current record
 *                                                 as an entity:update.
 *   client  → entity:unregister {ids}             unmounted; last one out forgets it
 *   client  → entity:interact   {id, action}      an INPUT: any mouse input the client's
 *                                                 raycast detected ("mouse-left-click",
 *                                                 "mouse-hover-enter", "mouse-scroll-up", …
 *                                                 — raised as the matching flag on the
 *                                                 machine's blackboard), or "door:<i>"
 *                                                 (toggles replicated state). Inputs cross
 *                                                 the wire, never triggers: the SERVER's
 *                                                 machine decides — nothing is client-owned.
 *   server  → entity:update     {id, st?, x?,y?,z?, vx?,vy?,vz?, ry?, anim?, sm?, state?}
 *                                                 changed fields only, ≤10Hz, to the
 *                                                 registrants. `anim` is the whole
 *                                                 animation-channel state (never bones);
 *                                                 sm = machine state id, mirrored by
 *                                                 clients for state-keyed visuals.
 *
 * Domains are the broadcast scope: nothing crosses a domain boundary except
 * the mover's own re-init. Entity sync inherits this scoping.
 *
 * Coordinates are the player's capsule CENTER in world units (entities: FEET);
 * `ry` is yaw in radians (three.js convention: rotation.y such that local +Z
 * faces the view direction). Colors are CSS hex strings.
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

// ── player data ────────────────────────────────────────────────────────────

/**
 * The persisted per-player blob. Its SHAPE is still open — settings and
 * progress will land here as named keys once they exist (add them to this
 * type; the plumbing on both sides is shape-agnostic). Until then treat it as
 * an opaque object: nothing may assume a key inside it.
 */
export type PlayerData = Record<string, unknown>;

/** Serialized size cap for one player's blob — a patch that would exceed it is rejected. */
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
  /** Client's local send time (ms); echoed back untouched. */
  t0: number;
}

/** Shallow-merge `patch` into the sender's persisted blob. */
export interface DataPatchMessage {
  t: "data:patch";
  patch: PlayerData;
}

export interface EntityRegisterItem {
  id: string;
  /** Actor descriptor id — selects the server-side simulation (actor catalog). */
  kind: string;
  /** Spawn origin (world). */
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
  /** Server-assigned spawn OFFSET (x/z) from the domain's spawn point, so
   *  simultaneous joiners don't stack. The client owns terrain height. */
  spawn: { x: number; z: number };
  domain: DomainId;
  players: PlayerSnapshot[];
  serverTime: number;
  /** YOUR persisted data (see PlayerData). */
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

/** The sender's (merged) persisted blob after a data:patch. */
export interface DataMessage {
  t: "data";
  data: PlayerData;
}

/** Server-published entity fields — every one optional so updates carry only changes. */
export interface EntityUpdateFields {
  /** Server time (ms) of the tick this pose was published — present whenever
   *  x/y/z are. Clients interpolate the published track on this clock
   *  (snapshot interpolation), never on message arrival time. */
  st?: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Yaw, three.js rotation.y. */
  ry?: number;
  /** The animation channel's whole state (clip, loop, speed, paused, clocks
   *  in SERVER time) — self-contained, so a client can compute the exact clip
   *  time on its delayed render clock. */
  anim?: AnimationState;
  /** The server-side state machine's current state id (mirrored for visuals). */
  sm?: string;
  /** Small replicated state blob (component-defined, e.g. door flags). */
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
