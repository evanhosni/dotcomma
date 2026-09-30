import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertSchemaCurrent, runMigrations } from "./migrations.js";

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
