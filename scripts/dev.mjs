#!/usr/bin/env node
/**
 * npm run dev — server (tsx watch :8080) + client (craco :3000) in one terminal;
 * either exiting, or Ctrl+C, kills both. First run installs server/ deps and
 * creates + migrates the local SQLite.
 *
 *   node scripts/dev.mjs [--no-open] [--server-only] [--client-only]
 *
 * No dependencies: `concurrently` was considered and skipped.
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

// Own process group per child (detached): MEASURED, killing just `npm` left the
// webpack dev server listening on :3000. Shutdown signals the direct child FIRST
// so npm → tsx → server forward SIGTERM in order and the server finishes its
// flush (signalling the whole group at once force-killed it mid-flush, also
// measured), then the rest of the group after a grace period. Windows has no
// groups — taskkill /T.
const spawnNpm = (cwd, npmArgs, extraEnv = {}) =>
  spawn("npm", npmArgs, { cwd, env: { ...process.env, ...extraEnv }, stdio: "pipe", shell: isWin, detached: !isWin });

const KILL_GRACE_MS = 3000;
/** The group id outlives its leader, so this also reaps grandchildren an exited npm left behind. */
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

const forwardOutput = (child, name) => {
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

// A stale watcher surfaces as a cryptic EADDRINUSE deep in the server log; say
// what holds the port instead. macOS/Linux only.
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
  forwardOutput(child, name);
  child.on("exit", (code, signal) => {
    process.stdout.write(`${tag[name]} exited (${signal ?? code})\n`);
    killGroup(child);
    children.delete(name);
    if (!shuttingDown) shutdown(code ?? 0);
    else if (children.size === 0) process.exit(code ?? 0);
  });
};

if (withServer) start("server", spawnNpm(serverDir, ["run", "dev"]));
if (withClient) start("client", spawnNpm(root, ["start"], args.has("--no-open") ? { BROWSER: "none" } : {}));

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
console.log(`dev: ${[withServer && "server :8080", withClient && "client :3000"].filter(Boolean).join(" + ")} — Ctrl+C stops both`);
