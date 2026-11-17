import type { Migration } from "./types";

export const MIGRATIONS: readonly Migration[] = [
  {
    name: "players table",
    up(db) {
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
