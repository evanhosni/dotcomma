import { PLAYER_DATA_MAX_BYTES, type PlayerData } from "../../../src/net/protocol";
import { loadPlayer, savePlayerData } from "../data/players.js";

/**
 * In-memory side of the `players` table: one record per connected IDENTITY (two
 * tabs = one record). WRITE POLICY, never on the tick: save when the last session
 * leaves if dirty, else at most once per SAVE_INTERVAL_MS if dirty, plus saveAll()
 * on shutdown. When named keys arrive, `validatePatch` is where they get checked.
 * All SQL stays in data/players.ts.
 */

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

export const playerDataBytes = (d: PlayerData): number => Buffer.byteLength(JSON.stringify(d), "utf8");

/** The merged blob when `patch` is a plain object whose merge fits the cap, else null. */
export const validatePatch = (current: PlayerData, patch: unknown): PlayerData | null => {
  if (!isPlainObject(patch)) return null;
  const merged = { ...current, ...patch };
  if (playerDataBytes(merged) > PLAYER_DATA_MAX_BYTES) return null;
  return merged;
};

export class PlayerPersistence {
  private readonly byIdentity = new Map<string, PersistedPlayer>();

  attach(identity: string, now = Date.now()): PersistedPlayer {
    let p = this.byIdentity.get(identity);
    if (!p) {
      const record = loadPlayer(identity);
      p = { identity, data: record.data, sessions: 0, dirty: false, savedAt: now };
      this.byIdentity.set(identity, p);
    }
    p.sessions++;
    return p;
  }

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

  /** The merged blob, or null when refused or the identity is unknown. */
  patch(identity: string, patch: unknown): PlayerData | null {
    const p = this.byIdentity.get(identity);
    if (!p) return null;
    const merged = validatePatch(p.data, patch);
    if (!merged) return null;
    p.data = merged;
    p.dirty = true;
    return merged;
  }

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
