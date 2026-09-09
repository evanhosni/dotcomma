# <span style="font-family: monospace">[dotcomma]</span>

<span style="font-family: monospace">[explore the digital world of dotcomma](https://dotcomma.io)</span>
## Server, database, deploy

The game is one Railway service: `server/` (Node 24, Express + `ws`) serves the
built CRA client from `build/` and runs the WebSocket game loop on the same
port. Player data lives in SQLite (`node:sqlite`, no ORM) on a Railway volume.
Assets are NOT served by it — they come from a public Cloudflare R2 bucket.

### Local

```
npm install && (cd server && npm install)
npm run build              # client → build/, server → server/dist/
(cd server && npm run db:migrate)   # creates data/dotcomma.sqlite at schema 1
npm run start:server       # http://localhost:8080  (PORT, DATABASE_PATH via server/.env)
```

Dev loop: `npm start` (client on :3000, talks to `ws://localhost:8080` via
`.env.development`) plus `npm run dev:server` (tsx watch). Copy `.env.example`
for every variable; server vars go in `server/.env`, client vars in `.env`.

### Database

- `players` is the only table; `data` is an opaque JSON blob whose shape is
  still undefined. All SQL is in `server/src/data/`.
- Migrations: `server/src/data/migrations.ts`, append-only, versioned by
  `PRAGMA user_version`. Read the header comment before adding one.
- `npm run db:migrate` (`--dry-run`, `--no-backup`) applies pending migrations
  after taking a `<file>.<timestamp>.bak` copy. `npm run db:inspect [--id X]`
  shows version, row count, and rows. From the repo root these run the compiled
  CLIs (`server/dist/cli`), so build first; inside `server/` they run from source.
- The server REFUSES to boot on a stale schema. Order of operations for a
  schema change: **migrate first, then deploy** — `railway ssh` into the
  service and run `npm run db:migrate` there (the volume is only reachable from
  the container), then push. `DB_AUTO_MIGRATE=1` exists only for an empty
  volume's very first boot; unset it afterwards.
- Write policy: saved on disconnect if changed, otherwise at most every 30s per
  player if changed, never on the tick. A crash loses at most 30s of a player's
  changes; graceful SIGTERM flushes everything.

### Railway

- One service, one volume mounted at `/data`, `DATABASE_PATH=/data/dotcomma.sqlite`.
- The volume binds to a single instance: **no replicas and no zero-downtime
  deploys** (a deploy is a brief restart; clients reconnect with backoff).
- **Enable volume backups** in the Railway dashboard (Volume → Backups). The
  `.bak` files from `db:migrate` are the second copy, on the same volume.

### Deploying

Railway deploys whatever lands on `main` (GitHub integration; `railway.json`
supplies the build and start commands, `.node-version` pins Node 24, and the
`.npmrc` files force dev dependencies to install so `craco build` and `tsc`
exist at build time). `npm run deploy` is the release cut:

1. refuses on a dirty tree, off `main`, or behind `origin/main`;
2. reads `version` from the root `package.json`;
3. if tag `v<version>` is unshipped → uses it as-is (you set it by hand);
4. if it is shipped → bumps the patch in `package.json` and `package-lock.json`
   and commits; if the bumped tag exists too it stops rather than guess;
5. tags `v<version>` and pushes `main` + the tag.

`npm run deploy:dry` prints the plan without changing anything. To ship a minor
or major, edit `version` in `package.json` by hand, commit, then deploy.

**Schema changes: migrate first, then deploy.** `railway ssh` into the
service, `npm run db:migrate` (it backs up first), confirm with
`npm run db:inspect`, then `npm run deploy`. The new build refuses to boot
against a stale schema, so doing it in the other order is a crash, not a
silent migration.

There are no GitHub Actions; `scripts/deploy.mjs` runs on your machine.
