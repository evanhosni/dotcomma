import { existsSync } from "node:fs";
import { backup } from "node:sqlite";
import { openDatabase, resolveDatabasePath } from "../data/db.js";
import { getSchemaVersion, MIGRATIONS, pendingMigrations, runMigrations } from "../data/migrations.js";

/**
 * `npm run db:migrate` — apply pending migrations to DATABASE_PATH.
 *
 *   --dry-run     show the current version and what WOULD run; change nothing
 *   --no-backup   skip the automatic <file>.<timestamp>.bak copy
 *
 * Run this BEFORE deploying code that expects the new schema (the server
 * refuses to boot against a stale schema). On Railway: `railway ssh` into the
 * service, then `npm run db:migrate` — the volume is only reachable from the
 * running container.
 */
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const noBackup = args.has("--no-backup");

const file = resolveDatabasePath();
const existed = existsSync(file);
const db = openDatabase(file);
const version = getSchemaVersion(db);
const pending = pendingMigrations(db);

console.log(`database : ${file}${existed ? "" : "  (new)"}`);
console.log(`schema   : version ${version} (code expects ${MIGRATIONS.length})`);
if (pending.length === 0) {
  console.log("nothing to do — schema is current.");
  db.close();
  process.exit(0);
}
console.log(`pending  :`);
pending.forEach((m, i) => console.log(`  ${version + i}. ${m.name}`));

if (dryRun) {
  console.log("dry run — nothing applied.");
  db.close();
  process.exit(0);
}

if (existed && !noBackup) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = `${file}.${stamp}.bak`;
  await backup(db, target);
  console.log(`backup   : ${target}`);
}

try {
  const { from, to } = runMigrations(db, (line) => console.log(`  ${line}`));
  console.log(`migrated : ${from} → ${to}`);
} catch (err) {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.cause) console.error("cause:", err.cause);
  process.exitCode = 1;
} finally {
  db.close();
}
