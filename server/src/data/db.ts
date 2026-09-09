import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertSchemaCurrent, runMigrations } from "./migrations.js";

/**
 * Database handle. `node:sqlite` (built in, Node ≥ 22.5; no flag on Node 24),
 * raw SQL, no ORM. ALL SQL lives in this folder (server/src/data/) — the rest
 * of the server only ever calls the named functions exported from here.
 *
 * FILE LOCATION: `DATABASE_PATH` env var. On Railway that is a path on the
 * mounted volume (e.g. /data/dotcomma.sqlite). Locally it defaults to
 * <repo>/data/dotcomma.sqlite (gitignored). WAL mode writes two sidecar files
 * next to it (-wal, -shm) — they are part of the database, keep them together.
 *
 * SCHEMA GUARD: the app's handle (getDb) REFUSES to open a database whose
 * schema is behind the code — migrations are run explicitly (`npm run
 * db:migrate`) so a deploy never mutates live player data unseen. The one
 * exception is DB_AUTO_MIGRATE=1, meant for a brand-new volume's first boot.
 */

/** DATABASE_PATH, else <cwd>/data/dotcomma.sqlite — the server is bundled
 *  (esbuild), so module-relative paths would depend on the bundle layout.
 *  Run from the repo root locally; Railway sets DATABASE_PATH. */
export const resolveDatabasePath = (): string =>
  process.env.DATABASE_PATH ?? path.resolve(process.cwd(), "data/dotcomma.sqlite");

/** Open (creating if needed) with the required pragmas. No schema check —
 *  this is what the migration CLI uses, since its whole job is a stale schema. */
export const openDatabase = (file: string): DatabaseSync => {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL: readers never block the writer and vice versa — the default rollback
  // journal serializes them, which bites as soon as a periodic save overlaps
  // a connect-time load.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // Wait instead of failing with SQLITE_BUSY when the CLI and the server touch
  // the file at the same moment.
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
};

let appDb: DatabaseSync | null = null;

/** THE app handle — one connection for the process, opened on first use. */
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
