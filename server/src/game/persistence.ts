import { PLAYER_DATA_MAX_BYTES, type PlayerData } from "../../../src/net/protocol";
import { loadPlayer, savePlayerData } from "../data/players.js";

/**
 * PLAYER PERSISTENCE — the in-memory side of the `players` table: one record
 * per connected IDENTITY (two tabs = two sessions, ONE record), loaded on the
 * first session's connect, patched by the game, written back under the
 * WRITE POLICY, dropped when the last session leaves.
 *
 * WRITE POLICY — never on the tick:
 *   - when the identity's LAST session disconnects, if the blob changed since
 *     the last save;
 *   - otherwise at most once per SAVE_INTERVAL_MS per identity, and only if it
 *     changed (flushDirty, driven by a coarse timer in index.ts);
 *   - saveAll() on shutdown flushes everything that changed.
 *
 * The blob's SHAPE is still open (PlayerData in src/net/protocol.ts). Reads
 * and writes here are shape-agnostic; when named keys arrive, `validatePatch`
 * is where a key gets checked, clamped or refused, and typed accessors go
 * next to it. All SQL stays in data/players.ts.
 */

/** Minimum gap between periodic saves of one identity's blob. */
export const SAVE_INTERVAL_MS = 30_000;

export interface PersistedPlayer {
  identity: string;
  data: PlayerData;
  /** Connected sessions sharing this identity. */
  sessions: number;
  dirty: boolean;
  savedAt: number;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Serialized size of a blob (the cap the client also enforces). */
export const playerDataBytes = (d: PlayerData): number => Buffer.byteLength(JSON.stringify(d), "utf8");

/** The merged blob if `patch` is acceptable, else null. Shape-agnostic today:
 *  a plain object whose merge fits the size cap. */
export const validatePatch = (current: PlayerData, patch: unknown): PlayerData | null => {
  if (!isPlainObject(patch)) return null;
  const merged = { ...current, ...patch };
  if (playerDataBytes(merged) > PLAYER_DATA_MAX_BYTES) return null;
  return merged;
};

export class PlayerPersistence {
  private readonly byIdentity = new Map<string, PersistedPlayer>();

  /** A session connected: load the row on the identity's first session. */
  attach(identity: string, now = Date.now()): PersistedPlayer {
    let p = this.byIdentity.get(identity);
    if (!p) {
      const record = loadPlayer(identity); // creates the row on first ever connect
      p = { identity, data: record.data, sessions: 0, dirty: false, savedAt: now };
      this.byIdentity.set(identity, p);
    }
    p.sessions++;
    return p;
  }

  /** A session left: the identity's last session out saves if dirty and drops the record. */
  detach(identity: string): void {
    const p = this.byIdentity.get(identity);
    if (!p) return;
    if (--p.sessions > 0) return;
    if (p.dirty) this.save(p);
    this.byIdentity.delete(identity);
  }

  get(identity: string): PersistedPlayer | undefined {
    return this.byIdentity.get(identity);
  }

  /** Shallow-merge a validated patch; the merged blob, or null when refused/unknown. */
  patch(identity: string, patch: unknown): PlayerData | null {
    const p = this.byIdentity.get(identity);
    if (!p) return null;
    const merged = validatePatch(p.data, patch);
    if (!merged) return null;
    p.data = merged;
    p.dirty = true;
    return merged;
  }

  /** Replace an identity's blob wholesale (server-side game logic). */
  set(identity: string, data: PlayerData): void {
    const p = this.byIdentity.get(identity);
    if (!p) return;
    p.data = data;
    p.dirty = true;
  }

  private save(p: PersistedPlayer, now = Date.now()): void {
    savePlayerData(p.identity, p.data);
    p.dirty = false;
    p.savedAt = now;
  }

  /** Periodic save sweep — call from a coarse timer, never from a tick. */
  flushDirty(now = Date.now()): number {
    let n = 0;
    for (const p of this.byIdentity.values()) {
      if (p.dirty && now - p.savedAt >= SAVE_INTERVAL_MS) {
        this.save(p, now);
        n++;
      }
    }
    return n;
  }

  /** Shutdown: save everything that changed, regardless of interval. */
  saveAll(): number {
    let n = 0;
    for (const p of this.byIdentity.values()) {
      if (p.dirty) {
        this.save(p);
        n++;
      }
    }
    return n;
  }

  get size(): number {
    return this.byIdentity.size;
  }
}
