import type { Migration } from "./types";
import { MIGRATIONS } from "./registry";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * APPEND-ONLY. The array INDEX is the version (`PRAGMA user_version` = last index
 * run + 1); each migration runs in its own transaction with the version bump, so a
 * failure leaves the database at the old version.
 *
 * RULES:
 *   1. NEVER edit or reorder a shipped migration — databases that ran it won't
 *      run it again and new databases diverge silently. Append instead.
 *   2. SQLite's ALTER TABLE only does ADD/DROP/RENAME COLUMN and RENAME TABLE.
 *      Anything else is create-copy-drop-rename (atomic under the transaction,
 *      but holds the write lock — quiet hours on a big table).
 *   3. Reshaping `players.data` is plain SQL too (json_extract/json_set/
 *      json_remove), or read+write rows in JS inside `up`.
 *   4. `npm run db:migrate` backs up first (<file>.<timestamp>.bak) unless --no-backup.
 */

/** 0 = never migrated. */
export const getSchemaVersion = (db: DatabaseSync): number => {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return Number(row.user_version);
};

export const pendingMigrations = (db: DatabaseSync): readonly Migration[] => MIGRATIONS.slice(getSchemaVersion(db));

/** Returns {from, to}; equal when nothing was pending. */
export const runMigrations = (db: DatabaseSync, log: (line: string) => void = () => {}): { from: number; to: number } => {
  const from = getSchemaVersion(db);
  for (let i = from; i < MIGRATIONS.length; i++) {
    const m = MIGRATIONS[i]!;
    log(`migration ${i} "${m.name}" …`);
    db.exec("BEGIN");
    try {
      m.up(db);
      // PRAGMA cannot take a bound parameter.
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${i} "${m.name}" failed and was rolled back (database stays at version ${i})`, {
        cause: err,
      });
    }
    log(`migration ${i} done → schema version ${i + 1}`);
  }
  return { from, to: Math.max(from, MIGRATIONS.length) };
};

export const assertSchemaCurrent = (db: DatabaseSync, file: string): void => {
  const have = getSchemaVersion(db);
  const want = MIGRATIONS.length;
  if (have === want) return;
  if (have < want) {
    throw new Error(
      `database ${file} is at schema version ${have}, this build expects ${want}. ` +
        `Run \`npm run db:migrate\` (it backs up first), or set DB_AUTO_MIGRATE=1 for a brand-new database's first boot.`,
    );
  }
  throw new Error(
    `database ${file} is at schema version ${have}, NEWER than this build (${want}). ` +
      `You are running old code against a migrated database — deploy the matching build.`,
  );
};

/**
 * `node:sqlite`, raw SQL, no ORM. ALL SQL lives in server/src/data/. WAL mode
 * writes -wal/-shm sidecars next to the file — they are part of the database.
 */

/** cwd-relative because the server is bundled (module-relative would depend on
 *  the bundle layout). Railway sets DATABASE_PATH to the volume. */
export const resolveDatabasePath = (): string =>
  process.env.DATABASE_PATH ?? path.resolve(process.cwd(), "data/dotcomma.sqlite");

/** No schema check — the migration CLI's whole job is a stale schema. */
export const openDatabase = (file: string): DatabaseSync => {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // The default rollback journal serializes readers and the writer, which bites
  // as soon as a periodic save overlaps a connect-time load.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // Wait instead of SQLITE_BUSY when the CLI and the server touch the file together.
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
};

let appDb: DatabaseSync | null = null;

/** REFUSES a schema behind the code (migrations run explicitly so a deploy never
 *  mutates live data unseen); DB_AUTO_MIGRATE=1 is for a brand-new volume's first boot. */
export const getDb = (): DatabaseSync => {
  if (appDb) return appDb;
  const file = resolveDatabasePath();
  const db = openDatabase(file);
  if (process.env.DB_AUTO_MIGRATE === "1") {
    const { from, to } = runMigrations(db, (line) => console.log(`[db] ${line}`));
    if (to > from) console.log(`[db] auto-migrated ${file} from schema ${from} to ${to}`);
  }
  assertSchemaCurrent(db, file);
  appDb = db;
  return db;
};

export const closeDb = (): void => {
  appDb?.close();
  appDb = null;
};
