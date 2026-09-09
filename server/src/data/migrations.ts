import type { DatabaseSync } from "node:sqlite";

/**
 * SCHEMA MIGRATIONS — an ordered, APPEND-ONLY list.
 *
 * The version counter is SQLite's built-in `PRAGMA user_version`: after
 * migration index N has run, user_version = N + 1. On `npm run db:migrate` the
 * runner reads user_version and runs every migration from that index onward,
 * each inside its own BEGIN/COMMIT (ROLLBACK on throw) with the user_version
 * bump in the SAME transaction — so a failed migration leaves the database
 * exactly as it was, at the old version.
 *
 * RULES (future me, read these):
 *   1. NEVER edit a migration that has shipped. Databases that already ran it
 *      will not run it again, so the edit silently applies to new databases
 *      only and the two diverge. Append a new migration instead.
 *   2. NEVER reorder or delete entries. The index IS the version.
 *   3. SQLite's ALTER TABLE only supports ADD COLUMN, DROP COLUMN, RENAME
 *      COLUMN and RENAME TABLE. Changing a column's type, constraints,
 *      default, or NOT NULL-ness, adding/removing a PRIMARY KEY or CHECK, or
 *      anything else needs the create-copy-drop-rename dance:
 *          CREATE TABLE players_new (...new shape...);
 *          INSERT INTO players_new SELECT ... FROM players;
 *          DROP TABLE players;
 *          ALTER TABLE players_new RENAME TO players;
 *      (recreate indexes/triggers after). Because the runner wraps the whole
 *      migration in a transaction this is atomic, but on a big table it holds
 *      the write lock for the duration — run it during quiet hours.
 *   4. A migration that reshapes `players.data` (the JSON blob) is plain SQL
 *      too: SQLite has json_extract / json_set / json_remove. Or read rows in
 *      JS inside `up` and write them back — the DatabaseSync handle is passed
 *      in for exactly that.
 *   5. Take a backup first. `npm run db:migrate` does one automatically
 *      (<file>.<timestamp>.bak) unless --no-backup; Railway volume backups
 *      are the second copy.
 */

export interface Migration {
  /** Descriptive, for the log. The INDEX is the version, not this. */
  name: string;
  up(db: DatabaseSync): void;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    name: "players table",
    up(db) {
      // `data` is an OPAQUE JSON object; its shape is deliberately undefined
      // for now (see data/players.ts). STRICT: column types are enforced.
      db.exec(`
        CREATE TABLE players (
          id         TEXT PRIMARY KEY,            -- anonymous uuid from the client
          data       TEXT NOT NULL DEFAULT '{}',  -- open JSON blob, shape TBD
          created_at INTEGER NOT NULL,            -- unix ms
          updated_at INTEGER NOT NULL             -- unix ms
        ) STRICT
      `);
    },
  },
];

/** Current schema version of an opened database (0 = never migrated). */
export const getSchemaVersion = (db: DatabaseSync): number => {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return Number(row.user_version);
};

export const pendingMigrations = (db: DatabaseSync): readonly Migration[] => MIGRATIONS.slice(getSchemaVersion(db));

/** Run every migration from the database's version onward. Returns the
 *  version range applied ({from, to}; equal when nothing was pending). */
export const runMigrations = (db: DatabaseSync, log: (line: string) => void = () => {}): { from: number; to: number } => {
  const from = getSchemaVersion(db);
  for (let i = from; i < MIGRATIONS.length; i++) {
    const m = MIGRATIONS[i]!;
    log(`migration ${i} "${m.name}" …`);
    db.exec("BEGIN");
    try {
      m.up(db);
      // PRAGMA cannot take a bound parameter; i is an integer we control.
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

/** Throw loudly unless the database is at exactly the version this code expects. */
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
