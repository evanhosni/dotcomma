/**
 * WIRE PROTOCOL — JSON text frames, one message per frame, discriminated on `t`.
 *
 * DUPLICATED deliberately from server/src/protocol.ts (CRA's
 * ModuleScopePlugin forbids importing across the src/ boundary and a shared
 * workspace package was judged more machinery than this file is worth).
 * Change both or change neither. The client is the COPY; the server file is canonical.
 *
 * IDS. Two different ids, do not conflate them:
 *   - `identity`  — the anonymous uuid the CLIENT generates once and keeps in
 *                   localStorage. It names the PERSISTED player (Phase 3's
 *                   players.id). Sent once, in `hello`, never broadcast.
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
 *   client  → debug:setData {data}               DEV ONLY (server env
 *                                                 DEBUG_DATA_WRITES=1, else ignored):
 *                                                 replace your persisted blob — exists
 *                                                 to exercise the persistence plumbing
 *                                                 before there is game logic to do it
 *   server  → pong    {t0, serverTime}            (protocol-level ws ping/pong is
 *                                                 ALSO used, server-side only —
 *                                                 browsers cannot observe it)
 *
 * Domains are the broadcast scope: nothing crosses a domain boundary except
 * the mover's own re-init. Phase 6's entity sync inherits this scoping.
 *
 * Coordinates are the player's capsule CENTER in world units; `ry` is yaw in
 * radians (three.js convention: rotation.y such that local +Z faces the view
 * direction). Colors are CSS hex strings.
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

/** The persisted per-player blob. Shape deliberately UNDEFINED for now —
 *  treat as opaque; nothing may assume a key inside it. */
export type PlayerData = Record<string, unknown>;

/** Dev-only plumbing test hook (see header). */
export interface DebugSetDataMessage {
  t: "debug:setData";
  data: PlayerData;
}

export type ClientMessage = HelloMessage | ClientMoveMessage | DomainMessage | PingMessage | DebugSetDataMessage;

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
  /** YOUR persisted data (opaque; see PlayerData). */
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

export type ServerMessage = InitMessage | JoinMessage | ServerMoveMessage | LeaveMessage | PongMessage;
