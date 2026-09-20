import { getDb } from "./db.js";

/**
 * The ONLY module touching the `players` table. Prepared statements are built
 * at module load, so this must load after the schema exists (getDb enforces it).
 */

import type { PlayerData } from "../../../src/net/protocol";
export type { PlayerData };

/** A type alias, not an interface: aliases get an implicit index signature, which
 *  makes the cast from node:sqlite's Record<string, SQLOutputValue> legal. */
type PlayerRow = {
  id: string;
  data: string;
  created_at: number;
  updated_at: number;
};

export interface PlayerRecord {
  id: string;
  data: PlayerData;
  createdAt: number;
  updatedAt: number;
}

const db = getDb();

const selectPlayer = db.prepare("SELECT id, data, created_at, updated_at FROM players WHERE id = ?");
const insertPlayer = db.prepare(
  "INSERT INTO players (id, data, created_at, updated_at) VALUES (?, '{}', ?, ?) RETURNING id, data, created_at, updated_at",
);
const upsertData = db.prepare(
  `INSERT INTO players (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
);
const countAll = db.prepare("SELECT COUNT(*) AS n FROM players");
const listRecent = db.prepare("SELECT id, data, created_at, updated_at FROM players ORDER BY updated_at DESC LIMIT ?");

/** A corrupt/non-object blob degrades to {} instead of crashing the connect. */
const parseData = (text: string): PlayerData => {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as PlayerData) : {};
  } catch {
    return {};
  }
};

const toRecord = (row: PlayerRow): PlayerRecord => ({
  id: row.id,
  data: parseData(row.data),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const findPlayer = (id: string): PlayerRecord | null => {
  const row = selectPlayer.get(id) as PlayerRow | undefined;
  return row ? toRecord(row) : null;
};

/** Creates the row on first connect. */
export const loadPlayer = (id: string): PlayerRecord => {
  const existing = findPlayer(id);
  if (existing) return existing;
  const now = Date.now();
  const row = insertPlayer.get(id, now, now) as PlayerRow;
  return toRecord(row);
};

/** Upsert: recreates the row if it somehow vanished. */
export const savePlayerData = (id: string, data: PlayerData): void => {
  const now = Date.now();
  upsertData.run(id, JSON.stringify(data), now, now);
};

export const countPlayers = (): number => {
  const row = countAll.get() as { n: number };
  return Number(row.n);
};

export const listPlayers = (limit = 20): PlayerRecord[] => {
  const rows = listRecent.all(limit) as PlayerRow[];
  return rows.map(toRecord);
};
