import { existsSync } from "node:fs";
import { openDatabase, resolveDatabasePath } from "../data/db.js";
import { getSchemaVersion, MIGRATIONS } from "../data/migrations.js";

/**
 * `npm run db:inspect [-- --id <identity>] [-- --limit N]` — look at the
 * database without touching it: file, schema version, row count, and the
 * most recently updated player rows (or one row by id).
 */
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const wantId = flag("--id");
const limit = Number(flag("--limit") ?? 20);

const file = resolveDatabasePath();
if (!existsSync(file)) {
  console.log(`database : ${file}  (does not exist yet — the server or db:migrate creates it)`);
  process.exit(0);
}
const db = openDatabase(file);
const version = getSchemaVersion(db);
console.log(`database : ${file}`);
console.log(`schema   : version ${version} (code expects ${MIGRATIONS.length})`);
db.close();

if (version !== MIGRATIONS.length) {
  console.log("schema is not current — run db:migrate before inspecting rows.");
  process.exit(0);
}

// The data layer asserts a current schema at import, hence the dynamic import
// after the version check above.
const { countPlayers, findPlayer, listPlayers } = await import("../data/players.js");
const fmt = (ms: number) => new Date(ms).toISOString();

if (wantId) {
  const p = findPlayer(wantId);
  if (!p) {
    console.log(`no row for id ${wantId}`);
  } else {
    console.log(`id         : ${p.id}`);
    console.log(`created_at : ${fmt(p.createdAt)}`);
    console.log(`updated_at : ${fmt(p.updatedAt)}`);
    console.log(`data       : ${JSON.stringify(p.data, null, 2)}`);
  }
} else {
  console.log(`players  : ${countPlayers()}`);
  for (const p of listPlayers(limit)) {
    const blob = JSON.stringify(p.data);
    console.log(`  ${p.id}  updated ${fmt(p.updatedAt)}  ${blob.length > 80 ? blob.slice(0, 77) + "..." : blob}`);
  }
}
