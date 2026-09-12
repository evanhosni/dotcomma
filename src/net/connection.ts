import { useSyncExternalStore } from "react";
import { getCurrentDomain, onDomainChange } from "../world/domains/navigation";
import type { ClientMessage, DomainId, ServerMessage } from "./protocol";

/**
 * THE game connection — one module-level singleton over the browser's native
 * WebSocket. Owns: URL resolution, the anonymous identity, connect + exponential
 * backoff reconnect, the hello/init handshake, the domain-change relay, an
 * app-level ping (liveness watchdog + server clock offset), and fan-out of
 * inbound messages to subscribers. It knows nothing about players, entities or
 * meshes — players/store.ts, entities/entityStore.ts and playerData.ts
 * subscribe to it.
 *
 * React reads it through useSyncExternalStore hooks (UI-cadence only: status,
 * self id). Per-frame consumers read the module-level getters directly.
 */

// ── URL — the ONE place the server address is resolved ─────────────────────

/** Same host as the page by default; REACT_APP_WS_URL overrides (dev: CRA's
 *  dev server is :3000 while the game server is :8080 — see .env.development).
 *  Inlined at build time by CRA, so a production override means a rebuild. */
export const getWebSocketUrl = (): string => {
  const explicit = process.env.REACT_APP_WS_URL;
  if (explicit) return explicit;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
};

// ── Identity — anonymous, persistent, per browser ──────────────────────────

const IDENTITY_KEY = "dotcomma.identity";

const randomUuid = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Insecure-context fallback (plain http on a LAN ip): not cryptographic, just unique enough.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

/** The player's anonymous uuid (Phase 3's persistence key). Created once and
 *  kept in localStorage; two tabs share it (they become two SESSIONS). */
export const getIdentity = (): string => {
  try {
    const existing = window.localStorage.getItem(IDENTITY_KEY);
    if (existing) return existing;
    const fresh = randomUuid();
    window.localStorage.setItem(IDENTITY_KEY, fresh);
    return fresh;
  } catch {
    // localStorage unavailable (privacy mode) → a per-page-load identity.
    return (sessionIdentity ??= randomUuid());
  }
};
let sessionIdentity: string | null = null;

// ── State ──────────────────────────────────────────────────────────────────

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

interface ConnectionState {
  status: ConnectionStatus;
  /** Our SESSION id (server-assigned) — null until init. */
  selfId: string | null;
  color: string | null;
  /** Server-assigned spawn offset from the domain spawn (latest init). */
  spawnOffset: { x: number; z: number } | null;
  /** Consecutive failed connection attempts (drives backoff). */
  attempts: number;
}

let state: ConnectionState = {
  status: "offline",
  selfId: null,
  color: null,
  spawnOffset: null,
  attempts: 0,
};
const stateListeners = new Set<() => void>();
const setState = (patch: Partial<ConnectionState>) => {
  state = { ...state, ...patch };
  stateListeners.forEach((l) => l());
};

export const getConnectionState = (): ConnectionState => state;
export const getSelfId = (): string | null => state.selfId;
/** Read by the Player while it holds at spawn — no React needed. */
export const getAssignedSpawnOffset = (): { x: number; z: number } | null => state.spawnOffset;

const subscribeState = (l: () => void) => {
  stateListeners.add(l);
  return () => {
    stateListeners.delete(l);
  };
};
export const useConnectionState = (): ConnectionState => useSyncExternalStore(subscribeState, getConnectionState);

// ── Inbound fan-out ────────────────────────────────────────────────────────

type MessageHandler = (msg: ServerMessage) => void;
const messageHandlers = new Set<MessageHandler>();
/** Subscribe to every inbound server message. Returns an unsubscribe. */
export const onServerMessage = (fn: MessageHandler): (() => void) => {
  messageHandlers.add(fn);
  return () => {
    messageHandlers.delete(fn);
  };
};

// ── Clock — server time estimate for deterministic content (Phase 6) ───────

let clockOffsetMs = 0; // serverTime − localTime
let bestRttMs = Infinity;
let haveClock = false;

const sampleClock = (t0: number, serverTime: number) => {
  const now = Date.now();
  const rtt = now - t0;
  const offset = serverTime + rtt / 2 - now;
  if (!haveClock) {
    clockOffsetMs = offset;
    bestRttMs = rtt;
    haveClock = true;
    return;
  }
  // Trust lower-rtt samples more: snap on a better one, blend on a comparable one, ignore a bad one.
  if (rtt <= bestRttMs) {
    clockOffsetMs = offset;
    bestRttMs = rtt;
  } else if (rtt < bestRttMs * 2 + 20) {
    clockOffsetMs += (offset - clockOffsetMs) * 0.25;
  }
};

/** Best estimate of the server's Date.now(). ±50ms is the target. */
export const getServerTime = (): number => Date.now() + clockOffsetMs;

// ── Socket lifecycle ───────────────────────────────────────────────────────

const PING_INTERVAL_MS = 15_000;
/** No pong for this long → the socket is dead even if the browser thinks otherwise. */
const PONG_TIMEOUT_MS = 40_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

let ws: WebSocket | null = null;
let started = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let lastPongAt = 0;
let helloSentAt = 0;
let manuallyClosed = false;

/** Send if the socket is open; silently drop otherwise (intent is re-sent
 *  after every init, so nothing is lost that matters). */
export const send = (msg: ClientMessage): boolean => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
};

const clearTimers = () => {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
};

const scheduleReconnect = () => {
  if (manuallyClosed || reconnectTimer) return;
  const n = state.attempts;
  const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** n) * (0.8 + Math.random() * 0.4);
  setState({ status: "reconnecting", attempts: n + 1, selfId: null });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    open();
  }, delay);
};

const open = () => {
  clearTimers();
  setState({ status: state.attempts === 0 ? "connecting" : "reconnecting", selfId: null });
  let socket: WebSocket;
  try {
    socket = new WebSocket(getWebSocketUrl());
  } catch (err) {
    console.warn("[net] websocket construct failed:", err);
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.onopen = () => {
    if (ws !== socket) return;
    lastPongAt = Date.now();
    helloSentAt = Date.now();
    send({ t: "hello", identity: getIdentity(), domain: getCurrentDomain() });
    pingTimer = setInterval(() => {
      if (Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
        console.warn("[net] no pong — treating connection as dead");
        socket.close(); // → onclose → reconnect
        return;
      }
      send({ t: "ping", t0: Date.now() });
    }, PING_INTERVAL_MS);
  };

  socket.onmessage = (ev) => {
    if (ws !== socket || typeof ev.data !== "string") return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(ev.data) as ServerMessage;
    } catch {
      return; // malformed → ignore
    }
    if (typeof msg !== "object" || msg === null || typeof msg.t !== "string") return;

    switch (msg.t) {
      case "init":
        // A successful handshake resets the backoff.
        setState({
          status: "connected",
          selfId: msg.id,
          color: msg.color,
          spawnOffset: msg.spawn,
          attempts: 0,
        });
        lastPongAt = Date.now();
        // First clock sample from the hello→init round trip, so the shared
        // world clock (day/night, deterministic entities) is right from the
        // first frame instead of after the first 15s ping; then ping at once
        // for a tighter one.
        if (helloSentAt) sampleClock(helloSentAt, msg.serverTime);
        send({ t: "ping", t0: Date.now() });
        break;
      case "pong":
        lastPongAt = Date.now();
        sampleClock(msg.t0, msg.serverTime);
        break;
    }
    messageHandlers.forEach((h) => h(msg));
  };

  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    clearTimers();
    if (manuallyClosed) {
      setState({ status: "offline", selfId: null });
      return;
    }
    scheduleReconnect();
  };

  socket.onerror = () => {
    // onclose always follows onerror; nothing to do here but log once.
    if (ws === socket && state.status === "connecting") console.warn("[net] connection failed:", getWebSocketUrl());
  };
};

/** Boot the connection. Idempotent; called once from index.tsx. */
export const startConnection = () => {
  if (started) return;
  started = true;
  manuallyClosed = false;
  open();

  // Console access: __net.state, __net.serverTime() (player data: __playerData)
  (window as unknown as { __net: unknown }).__net = {
    get state() {
      return state;
    },
    serverTime: getServerTime,
    url: getWebSocketUrl,
    identity: getIdentity,
  };

  // World switch: the server treats it as leave(old) + join(new) and re-inits us.
  onDomainChange((domain: DomainId) => {
    send({ t: "domain", domain });
  });

  // A tab coming back from sleep: the browser may not have noticed the socket
  // died. Poke the watchdog so a dead socket is detected within one ping.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ws && ws.readyState === WebSocket.OPEN) {
      send({ t: "ping", t0: Date.now() });
    }
  });

  // Leaving the page (reload, typed URL, tab close, bfcache entry): close the
  // socket OURSELVES. MEASURED in Chrome: a navigated-away page's socket stayed
  // open on the server for the whole heartbeat window, so the other tabs saw a
  // ghost for up to 60s. pagehide fires for every kind of leave; a bfcache
  // restore then fires pageshow(persisted) and we reconnect.
  window.addEventListener("pagehide", () => {
    const socket = ws;
    ws = null; // onclose sees ws !== socket → no reconnect scheduled
    clearTimers();
    socket?.close(1000, "pagehide");
    setState({ status: "offline", selfId: null });
  });
  window.addEventListener("pageshow", (ev) => {
    if (ev.persisted && started && !manuallyClosed && !ws) open();
  });
};

/** Dev/console escape hatch. */
export const stopConnection = () => {
  manuallyClosed = true;
  clearTimers();
  ws?.close();
};
