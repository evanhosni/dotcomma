import { getDb } from "./db.js";

/**
 * Player persistence — the ONLY module that touches the `players` table.
 * Prepared statements are created once at module load (so this module must
 * load after the schema exists; getDb() enforces that). Named functions only;
 * no SQL escapes this folder.
 *
 * `data` is an OPAQUE JSON OBJECT. Its shape is deliberately undefined for
 * now — the server loads it, hands it to the game as-is, and writes back
 * whatever the game hands back. Nothing here may assume any key inside it.
 * When the real schema arrives, columns with real names get added by
 * migration and this blob shrinks (or stays as the "everything else" bag).
 */
import type { PlayerData } from "../../../src/net/protocol";
export type { PlayerData };

/** The row as SQLite returns it. Cast exactly ONCE per query, right here.
 *  (A type alias, not an interface: aliases get an implicit index signature,
 *  which is what makes the cast from node:sqlite's Record<string, SQLOutputValue>
 *  legal without a detour through `unknown`.) */
type PlayerRow = {
  id: string;
  data: string;
  created_at: number;
  updated_at: number;
};

/** What the rest of the server sees. */
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

/** Tolerant parse: a corrupt/non-object blob degrades to {} instead of crashing the connect. */
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

/** The row if it exists, else null. Never creates. */
export const findPlayer = (id: string): PlayerRecord | null => {
  const row = selectPlayer.get(id) as PlayerRow | undefined;
  return row ? toRecord(row) : null;
};

/** Connect-time load: the existing row, or a fresh one with data = {}. */
export const loadPlayer = (id: string): PlayerRecord => {
  const existing = findPlayer(id);
  if (existing) return existing;
  const now = Date.now();
  const row = insertPlayer.get(id, now, now) as PlayerRow;
  return toRecord(row);
};

/** Write the blob back (creating the row if it somehow vanished). */
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
