#!/usr/bin/env node
/**
 * npm run dev — start the game SERVER (server/, tsx watch on :8080) and the
 * CLIENT (craco dev server on :3000) together in one terminal, output
 * prefixed, both killed when either exits or on Ctrl+C.
 *
 * .env.development points the client at ws://localhost:8080, so this is the
 * standard local multiplayer setup (open two tabs of :3000).
 *
 * First run: installs server/ deps if missing and creates + migrates the
 * local SQLite (server/data/dotcomma.sqlite) — the server refuses to boot on
 * a missing/stale schema by design.
 *
 *   node scripts/dev.mjs [--no-open] [--server-only] [--client-only]
 *
 * No dependencies (concurrently was considered and skipped: a dev tool for
 * two processes isn't worth a package).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = resolve(root, "server");
const args = new Set(process.argv.slice(2));
const withServer = !args.has("--client-only");
const withClient = !args.has("--server-only");
const isWin = process.platform === "win32";

// Each child gets its OWN PROCESS GROUP (detached) so shutdown can kill the
// whole tree: killing just the `npm` process left the webpack dev server it
// spawned listening on :3000 (measured). But the tree is signalled in TWO
// steps — the direct child first, so npm → tsx → server forward SIGTERM in
// order and the server finishes its shutdown flush (signalling the whole group
// at once made tsx force-kill the server mid-flush, also measured); then, after
// a grace period, whatever is still alive in the group. Windows has no groups —
// taskkill /T.
const npm = (cwd, npmArgs, extraEnv = {}) =>
  spawn("npm", npmArgs, { cwd, env: { ...process.env, ...extraEnv }, stdio: "pipe", shell: isWin, detached: !isWin });

const KILL_GRACE_MS = 3000;
/** SIGTERM the rest of a child's process group (no-op once it is empty). The
 *  group id outlives its leader, so this also reaps grandchildren an already-
 *  exited npm left behind — the webpack dev server, measured. */
const killGroup = (child) => {
  if (isWin) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* group already gone */
  }
};
const killTree = (child) => {
  if (child.exitCode !== null) return;
  if (isWin) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => child.exitCode === null && killGroup(child), KILL_GRACE_MS).unref();
};

const color = (c) => (s) => `\x1b[${c}m${s}\x1b[0m`;
const tag = { server: color(36)("[server]"), client: color(35)("[client]") };

const pipe = (child, name) => {
  const forward = (stream) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        if (line.trim()) process.stdout.write(`${tag[name]} ${line}\n`);
      }
    });
    stream.on("end", () => buf.trim() && process.stdout.write(`${tag[name]} ${buf}\n`));
  };
  forward(child.stdout);
  forward(child.stderr);
};

// ── pre-flight: ports ──────────────────────────────────────────────────────
// A stale server/dev-server (a watcher left over from an earlier session)
// surfaces as a cryptic EADDRINUSE deep in the server log; say what holds the
// port instead. (macOS/Linux — Windows skips the check.)
const listenerOn = (port) => {
  if (isWin) return null;
  const r = spawnSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { encoding: "utf8" });
  const pid = (r.stdout || "").trim().split("\n")[0];
  if (!pid) return null;
  const cmd = spawnSync("ps", ["-o", "command=", "-p", pid], { encoding: "utf8" }).stdout.trim();
  return { pid, cmd };
};
for (const [name, port] of [withServer && ["server", 8080], withClient && ["client", 3000]].filter(Boolean)) {
  const held = listenerOn(port);
  if (held) {
    console.error(`${tag[name]} port ${port} is already in use by pid ${held.pid}: ${held.cmd}\n  stop it (kill ${held.pid}) or run with --${name === "server" ? "client" : "server"}-only`);
    process.exit(1);
  }
}

// ── first-run setup ────────────────────────────────────────────────────────
if (withServer) {
  if (!existsSync(resolve(serverDir, "node_modules"))) {
    console.log(`${tag.server} installing server dependencies…`);
    const r = spawnSync("npm", ["install"], { cwd: serverDir, stdio: "inherit", shell: isWin });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const dbFile = process.env.DATABASE_PATH ?? resolve(serverDir, "data/dotcomma.sqlite");
  if (!existsSync(dbFile)) {
    console.log(`${tag.server} no database at ${dbFile} — creating and migrating…`);
    const r = spawnSync("npm", ["run", "db:migrate"], { cwd: serverDir, stdio: "inherit", shell: isWin });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

// ── run both ───────────────────────────────────────────────────────────────
const children = new Map();
let shuttingDown = false;

const shutdown = (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [name, child] of children) {
    if (child.exitCode === null) {
      process.stdout.write(`${tag[name]} stopping…\n`);
      killTree(child);
    }
  }
  setTimeout(() => process.exit(code), KILL_GRACE_MS + 3000).unref();
};

const start = (name, child) => {
  children.set(name, child);
  pipe(child, name);
  child.on("exit", (code, signal) => {
    process.stdout.write(`${tag[name]} exited (${signal ?? code})\n`);
    killGroup(child); // anything it spawned and abandoned goes with it
    children.delete(name);
    if (!shuttingDown) shutdown(code ?? 0);
    else if (children.size === 0) process.exit(code ?? 0);
  });
};

if (withServer) start("server", npm(serverDir, ["run", "dev"]));
if (withClient) start("client", npm(root, ["start"], args.has("--no-open") ? { BROWSER: "none" } : {}));

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
console.log(`dev: ${[withServer && "server :8080", withClient && "client :3000"].filter(Boolean).join(" + ")} — Ctrl+C stops both`);
