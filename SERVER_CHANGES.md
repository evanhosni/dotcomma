# SERVER.md — the multiplayer server project, by service

A record of everything that turned dotcomma from a GitHub-Pages static site
into a hosted multiplayer game (built 2026-09-08 / 09): the code, the hosting,
DNS and registrar setup done by hand in dashboards, the decisions made along
the way (including the reversed ones), and how to operate each piece.
README.md is the short operator runbook; CLAUDE.md has the architecture rules;
this file is organized by SERVICE so each system can be read on its own.

Contents: 1 Overview · 2 Game server · 3 Database · 4 Multiplayer: players ·
5 Multiplayer: entities (NPCs, doors) · 6 Hosting (Railway) · 7 Domain & DNS
(Cloudflare, Squarespace, GitHub) · 8 Releases & deploy · 9 Assets/CDN
(deferred) · 10 Local development · 11 Open items

---

## 1. Overview

| Service | Where | State |
|---|---|---|
| Game server | `server/` — Express + `ws`, TypeScript, esbuild bundle, Node 24 | live |
| Database | SQLite via `node:sqlite`, `/data/dotcomma.sqlite` on a Railway volume | live, schema v1 |
| Players sync | `src/net/` + `server/src/game/world.ts` + `transport/ws.ts` | live |
| Entity sync | `server/src/game/entities/` + `src/net/entities/` + actor base | live (v0.0.3) |
| Hosting | Railway project `dotcomma` / env `production` / service `dotcomma` / volume `dotcomma-volume` | live |
| Domain | https://dotcomma.io — DNS on Cloudflare, registrar Squarespace | live |
| Assets/CDN | R2 bucket on `cdn.dotcomma.io` | DEFERRED (bucket deleted) |
| Deploy | `scripts/deploy.mjs` → git tag + push → Railway auto-deploy | live |

Runtime dependencies added: exactly `express` and `ws`. Dev: `typescript`,
`tsx`, `esbuild`, `@types/{node,express,ws}`. Removed: `gh-pages`. Declared:
`three@0.157.0` (was only a transitive dependency). Build system unchanged:
CRA 5 + craco, client at the repo root, React 18. Shared types are DUPLICATED
between `server/src/protocol.ts` (canonical) and `src/net/protocol.ts` because
CRA's ModuleScopePlugin forbids importing across `src/`.

Starting point: CRA + gh-pages, `homepage: "https://dotcomma.io"`, `CNAME`
file, DNS at Squarespace (four GitHub `A` records + `www`), no server, no
database, no env vars beyond `PUBLIC_URL`.

---

## 2. Game server (`server/`)

**What it does**: one HTTP server on `0.0.0.0:$PORT` (default 8080) that
serves the CRA build and hosts the WebSocket game transport on the same
origin (no CORS). It deliberately does NOT serve assets (see §9).

**Files**
- `src/index.ts` — boot: open + schema-check the db, http server, ws transport,
  30s save sweep, 10Hz world tick, SIGTERM/SIGINT shutdown (flush dirty
  players, close sockets).
- `src/http.ts` — Express static over `../../build`: `/static` gets
  `Cache-Control: public, max-age=31536000, immutable` (CRA hashes those),
  `index.html` gets `no-cache`, catch-all GET → `index.html` so the fake
  domain paths (`/`, `/glitch-city`) boot correctly.
- `src/protocol.ts` — the wire protocol (header comment is the spec).
- `src/game/world.ts` — rooms per domain, sessions, persistence write policy,
  the `Outbox` interface (the ONE abstraction, kept thin so Colyseus could
  replace `ws`).
- `src/transport/ws.ts` — sockets, frame validation, heartbeat.
- `src/game/entities/` — see §5. `src/data/` — see §3. `src/cli/` — see §3.

**Build**: `esbuild src/index.ts src/cli/migrate.ts src/cli/inspect.ts
--bundle --platform=node --format=esm --packages=external --outdir=dist
--outbase=src`. Bundled (not `tsc`-emitted) because the entity simulation
imports the client's state-machine files from `src/`, which use CRA-style
extensionless imports. `tsc -p tsconfig.json` is typecheck-only
(`moduleResolution: Bundler`, `noEmit`). Verified: the bundle contains no
runtime `three` import. Start: `node server/dist/index.js`.

**Config (env)**: `PORT`, `DATABASE_PATH`, `DB_AUTO_MIGRATE` (first boot
only), `DEBUG_DATA_WRITES` (dev only). Locally read from `server/.env` via
Node's `--env-file-if-exists`; Railway injects them. `.env.example` at the
repo root documents every variable and which file it lives in.

**Tests**: `cd server && npm test` (`node --import tsx --test test/*.test.ts`).

**History / gotchas**
- `.npmrc` + `server/.npmrc` contain `include=dev`: Railway builds with
  `NODE_ENV=production`, which would skip the dev deps that `craco`, `tsc`
  and `esbuild` are.
- The database path default moved from module-relative to
  `<cwd>/data/dotcomma.sqlite` when bundling changed the file layout; run
  from the repo root locally (Railway sets `DATABASE_PATH`).
- Frame cap raised 16KB → 64KB after registration batches of 256 actors
  blew it and made every client reconnect in a loop; batches are 64 now.

---

## 3. Database (`server/src/data/`)

**Engine**: `node:sqlite` (`DatabaseSync`), raw SQL, no ORM. Verified on
Node 24.19 with no flag and no warning. Pragmas on open: `journal_mode=WAL`,
`foreign_keys=ON`, `busy_timeout=5000`. WAL writes `-wal`/`-shm` sidecars —
they are part of the database.

**Schema** (version 1, the only migration):
```sql
CREATE TABLE players (
  id         TEXT PRIMARY KEY,            -- anonymous uuid from the client
  data       TEXT NOT NULL DEFAULT '{}',  -- open JSON blob, shape TBD
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
```
`data` is opaque: typed `Record<string, unknown>`, nothing assumes a key.

**Files**
- `db.ts` — `openDatabase()` (pragmas, no check — for the CLI) and the app
  handle `getDb()`, which REFUSES a schema behind the code unless
  `DB_AUTO_MIGRATE=1` (meant for an empty volume's first boot).
- `migrations.ts` — ordered append-only array versioned by
  `PRAGMA user_version`; each migration in its own BEGIN/COMMIT with the bump
  inside, ROLLBACK on throw. Header comment: never edit a shipped migration,
  never reorder, SQLite `ALTER TABLE` only does ADD/DROP/RENAME COLUMN and
  RENAME TABLE (else create-copy-drop-rename), JSON functions exist.
- `players.ts` — prepared once at module load; `findPlayer`, `loadPlayer`
  (creates the row on first connect), `savePlayerData` (UPSERT),
  `countPlayers`, `listPlayers`; one `as PlayerRow` cast per query.
- `cli/migrate.ts` — `--dry-run`, automatic `<file>.<timestamp>.bak` via
  `node:sqlite` `backup()` before applying. `cli/inspect.ts` — version, row
  count, rows, `--id`.

**Write policy** (in `World`): blob loaded at connect (row created if
missing); saved on disconnect IF changed; otherwise at most once per 30s per
player and only if changed (coarse timer, never on a tick); SIGTERM flushes
everything. Deviation from the spec: disconnect saves only if dirty, so a
stale second tab can't clobber the first.

**Operations**
- Local: `cd server && npm run db:migrate` creates `./data/dotcomma.sqlite`.
- Root scripts `npm run db:migrate` / `npm run db:inspect` run the compiled
  CLIs (need a build first).
- Production: `railway ssh` into the service, `npm run db:migrate`, inspect,
  THEN deploy. The server refuses to boot on a stale schema, so the other
  order is a crash, not a silent migration.
- Railway: `DATABASE_PATH=/data/dotcomma.sqlite`; `DB_AUTO_MIGRATE=1` was set
  for the first deploy only (log showed `auto-migrated ... from schema 0 to 1`)
  and then removed. Enable volume backups in the Railway dashboard.
- Dev hook: with `DEBUG_DATA_WRITES=1` on the server, `__net.setData({...})`
  in the browser console overwrites your blob (exercises the plumbing).

**Verified**: 25 checks — refusal on stale schema, first-boot migration, row
on first connect, no write before disconnect, saved on disconnect, survives
reconnect and server restart, migration not re-run, two identities → two
rows, WAL — plus the CLI end to end. Windows can't deliver SIGTERM to a child
process, so the shutdown flush was unit-tested via `World.saveAll()`.

---

## 4. Multiplayer: players (`src/net/`, `game/world.ts`, `transport/ws.ts`)

**Protocol** (JSON frames, `t` discriminator): `hello {identity, domain}` →
`init {id, color, spawn, domain, players[], serverTime, data}`; `join`;
`move {x,y,z, vx,vy,vz, ry}` (an INTENT change — sent on velocity/yaw/stop
change or drift > 0.75u every 250ms, 20Hz cap — never per frame; receivers
extrapolate and ease); `leave`; `domain` (switch = leave old room + join new
+ fresh `init`); `ping {t0}`/`pong {t0, serverTime}`.

**Two ids** (deliberate deviation): `identity` = client uuid in
`localStorage` (the persistence key, sent once in `hello`); `id` = the
server-assigned SESSION id carried by all presence messages. Two tabs share
an identity but are two sessions — which is what makes two-tab testing
possible at all.

**Server**: rooms per domain (presence is SCOPED, not filtered — entity sync
inherits it); color and golden-angle spawn-slot assignment; move relay (not
authoritative yet — `World.move` stores last-move time + velocity so
validation can slot in); malformed JSON ignored; a **30s protocol ping/pong
reaper** terminates sockets whose peer vanished (laptop sleep, wifi).

**Client**
- `connection.ts` — the ONE `getWebSocketUrl()` (`REACT_APP_WS_URL` or same
  host); identity; connect with exponential backoff + jitter; 15s app ping +
  dead-socket watchdog; server clock offset (`getServerTime()`, sampled from
  the hello→init round trip and every pong; used by day/night and entities);
  **`pagehide` closes the socket** (Chrome left navigated-away sockets open,
  measured with headless Chrome — ghosts lived until the reaper); `pageshow`
  reconnects from bfcache; `window.__net`.
- `remotePlayerStore.ts` — per-frame refs; React only sees a roster version.
- `RemotePlayers.tsx` — `CapsuleGeometry` (three r157 has it) per remote
  player in their color + a visor for facing; ONE useFrame; extrapolate last
  intent + ease, snap only on first appearance or a 40u teleport; materials
  through `prepareActorMaterial` (curvature/quantization).
- `LocalPlayerSync.tsx` — reads the Player's existing position ref + camera yaw.
- `NetOverlay.tsx` — top-right status + "here N".
- Touched: `navigation.ts` (multiple domain-change listeners),
  `CustomCanvas.tsx` (mounts), `Player.tsx` (server spawn offset applied only
  in the hold-at-spawn branch), `index.tsx` (starts the connection).

**Verified**: 15-check headless protocol test; two-tab capsule test;
reload/ghost scenario reproduced and fixed in headless Chrome.

---

## 5. Multiplayer: entities — NPCs and world objects

Goal: every player sees every actor in the same place, facing the same way,
playing the same animation — and authoring a new object involves no
networking. Three designs were built; the third is what runs.

- **Design 1 — server behavior files** (rejected): entity definitions with
  `sync: none | deterministic | server`, deterministic wander paths as pure
  functions of server time from an anchor, promotion to server authority in a
  sight cone, demotion by re-anchoring, behaviors as plain math in a server
  `behaviors.ts`. Worked, tests passed; rejected because behavior had to be
  written twice and the beeble component had to know about sync.
- **Design 2 — client ownership** (rejected): every actor runs locally on
  every client; the server names one registrant OWNER whose output is
  published, the rest are puppets. Beeble became networking-free, but the
  first registrant was effectively a host (only its player could alert a
  beeble). Ruled out: "NO ownership model — the server should be the owner;
  PvP must favor no player."
- **Design 3 — the server runs the actor's OWN state machine** (kept).

**How Design 3 works**
- `src/objects/actors/state/runner.ts` — `StateMachineRunner`, the Three-free
  machine core used by the client hook AND the server. Contract for a config:
  outputs go to the blackboard (`__vel_x/_z`, `__vel_y` undefined = gravity,
  `__yaw`, animation via `state.animation`); scene access guarded on
  `ctx.groupRef.current` (null on the server); no Three at runtime
  (`import type`; `LOOP_ONCE`/`LOOP_REPEAT` from `state/types.ts`).
- Server `game/entities/manager.ts` — per registered actor runs the machine
  from `kinds.ts` (descriptor id → config; the beeble's `stateMachine.ts` is
  imported straight from `src/`) at 10Hz with the NEAREST player in the
  domain, integrates x/z (y is client-resolved — the server has no terrain;
  `vy` is published for vertical motion like ascending), models one contact
  (stops 1.3u short of a player — without it the server's beeble walked
  through the player and out of its own sight cone), publishes changed fields
  ≤10Hz to the registrants: `x,y,z, vx,vy,vz, ry, clip+clipT0+once, sm
  (state id), state (blob)`. Inputs: `entity:interact "mouse-left-click"`
  raises the machine's blackboard flag (its own distance trigger decides);
  `door:<i>` toggles replicated `state.doors`.
- Entities exist because CLIENTS register them (`entity:register {id, kind,
  x, y, z}` on mount, `entity:unregister` on unmount; position-based spawn ids
  are identical everywhere). First registration creates the record and starts
  the machine; zero registrants = disposed. Interest = the registrant set, per
  domain. A registration is answered with the full record (late joiners covered).
- Client: the actor base (`Actor.tsx`) registers every actor (`serverSynced`
  attribute, default true, `false` opts a mount out) and builds a
  velocity-extrapolated target each frame; `ModelActor.tsx` +
  `kinematicMover.tsx` own the body (declared on the descriptor: `body:
  "fixed" | "kinematic" | "none"`, `collider`, `movement: "ground" | "free"`
  — the beeble's capsule/gravity/slopes were ported out of Beeble into here)
  and — since server physics — only PARK the capsule at the base's pose; the
  base draws the entity by SNAPSHOT INTERPOLATION of the server-stamped track
  200ms behind the server clock (`net/entities/interpolation.ts`; nothing is
  predicted, chased or resolved locally); ModelActor starts the server's clip
  on that same delayed clock;
  `useStateMachine` MIRRORS the server's state id with the server's outputs
  injected, so state-keyed visuals (head tracking, sphere-inflate) run;
  `useMouseEvents` forwards left clicks. `Beeble.tsx` is ~65 lines: machine +
  mouse hook + `ctx.move` from the blackboard. Buildings: door clicks send
  `door:i`, everyone applies `sync.state.doors`.
- Day/night cycle runs off `getServerTime()` so all players share the time of day.

**Wire additions**: `entity:register`, `entity:unregister`,
`entity:interact` (client→server); `entity:update` (server→clients) — every
positional update carries `st`, the server time of its tick (snapshot
interpolation).

**Verified**: `server/test/entities.test.ts` runs the real beeble machine on
the server (wanders and publishes; alerted by a SECOND player; forwarded click
→ ascend with `vy > 0`; doors toggle and late joiners get them; disposal).
Two-tab checks by Evan. Fixed on the way: wrong look direction (mirrored
blackboard held random local values), walking backwards (body chased across a
gap from spawn), never alerting (server walked through the player), the
16KB frame cap.

**Server physics (Sept 2026)**: the server runs headless Rapier
(`server/src/game/physics/`: `world.ts` + `chunks.ts` job queue / refcounted
chunk stores, `terrain.ts`, `obstacles.ts`, `buildings.ts`, `walker.ts`,
`npc.ts`, `players.ts`; the client's own `@dimforge/rapier3d-compat` bundled
from the root install — no server-side dependency) — the client's exact LOD1
terrain heightfields, building hulls, lamp/signal/pole cuboids and player
capsules — and moves every walker through THE shared character resolver
`src/physics/characterMovement.ts` (extracted verbatim from Player.tsx, which
calls it too). `entities/manager.ts` orchestrates the tick; `entities/publish.ts`
diffs what registrants last saw. Published x, y AND z are authoritative; the
client draws the published track by snapshot interpolation 200ms behind the
server clock (`net/entities/interpolation.ts`) and predicts nothing. Found on
the way: the client's `<Physics>` fixed 1/60 step made every per-frame-driven
kinematic body move at 60/fps of its speed above 60fps (now `timeStep="vary"`).
See CLAUDE.md "Server physics" for the module map and the measured gotchas.

**Known limits**: `body: "dynamic"` (pushables) not implemented; machine state
is lost when the last viewer leaves; only glitch-city has terrain on the server
(a walker registered in another domain runs its machine but stays put).

---

## 6. Hosting: Railway

**Layout**: project `dotcomma`, environment `production`, one service
`dotcomma` (from GitHub `evanhosni/dotcomma`, branch `main`, root `/`), one
volume `dotcomma-volume` mounted at `/data`, region US West, 1 replica,
Node 24.x (from `.node-version` = `24`). Service domain
`dotcomma-production.up.railway.app` (port **8080**), custom domain
`dotcomma.io` (the plan allows ONE custom domain; `www` is handled in
Cloudflare, §7).

**Config as code**: `railway.json` — builder RAILPACK, build `npm run build`,
start `node server/dist/index.js`, restart on failure. `.npmrc` files force
dev deps (see §2).

**Variables**: `DATABASE_PATH=/data/dotcomma.sqlite`. `DB_AUTO_MIGRATE=1` was
set for the first deploy only and removed. Never set `DEBUG_DATA_WRITES`.
`PORT` is Railway's.

**Constraints**: the volume binds one instance → no replicas, no
zero-downtime deploys (a deploy is a brief restart; clients reconnect with
backoff). Enable volume backups (Volume → Backups) — the `.bak` files from
`db:migrate` are the second copy, on the same volume.

**Things learned the hard way**
- The purple **Apply changes / Deploy** bar: staged dashboard edits
  (variables, volume, domain) hold ALL deployments — including GitHub pushes —
  until clicked.
- The service was created in "Upstream Repo" template mode with **Auto deploy
  disabled**: pushes `v0.0.2` and `v0.0.3` did not deploy until "Check for
  updates" was used. Fix: Settings → Source → **Enable** auto deploy; if a
  push still doesn't build, **Eject** from the upstream repo (converts to a
  plain GitHub-connected service; volume/variables/domain untouched).
- The Railway↔Cloudflare integration can write the DNS records itself
  (it did: the apex CNAME and the `_railway-verify` TXT).

**First production boot** (2026-09-08 22:02 PDT, `v0.0.1`): volume mounted,
migration 0 ran, `listening on http://0.0.0.0:8080`, two-tab test passed on
the Railway domain.

---

## 7. Domain & DNS: Cloudflare, Squarespace, GitHub Pages

**Registrar**: Squarespace (formerly Google Domains). Only its nameserver
setting is in use now; its own DNS records are inert and were left in place.

**Cloudflare zone `dotcomma.io`** (Free plan), set up 2026-09-08:
1. Account created → "Add a site" → **Connect a domain** → `dotcomma.io`,
   Free plan, DNS records imported automatically (GitHub Pages `A` ×4, `www`
   CNAME, `_domainconnect` CNAME). All flipped to **DNS only** so nothing
   changed during propagation. The GitHub `_github-pages-challenge-evanhosni`
   TXT was added by hand (it had not been imported).
2. Squarespace: **DNSSEC off** (must be, during a nameserver move); Domain
   Nameservers → custom → `adele.ns.cloudflare.com`,
   `kaiser.ns.cloudflare.com`. Zone Active the same evening.
3. Railway custom domain `dotcomma.io` added; the integration wrote
   CNAME `dotcomma.io` → `nc271ofm.up.railway.app` (**Proxied**) and TXT
   `_railway-verify`. The four GitHub `A` records and the old `www` were
   deleted. Cloudflare flattens the apex CNAME (Squarespace couldn't — one
   reason to stay on Cloudflare).
4. `www`: CNAME `www` → `dotcomma.io` (**Proxied**, required for the rule to
   fire) + Rules → Redirect Rules → template **"Redirect from WWW to root"**.
5. SSL/TLS → Overview → encryption mode **Full** (Flexible = redirect loop
   with Railway; Full strict later once Railway's cert is confirmed).
   Edge Certificates → **Always Use HTTPS** on. HSTS left off. Network →
   WebSockets on (default).
6. Final records: CNAME `dotcomma.io` (proxied) · CNAME `www` (proxied) ·
   TXT `_railway-verify` · CNAME `_domainconnect` (Squarespace; delete after
   the transfer). Recommendations banner about email/MX is irrelevant.

**Cloudflare things tried and removed**: an R2 bucket `dotcomma-assets` and
the R2 subscription (see §9). No CORS policy, custom domain, or API token
remain. Workers Free and the zone's Free Plan rows in Billing are defaults —
leave them.

**GitHub Pages retired**: account Settings → Pages → verified domain
`dotcomma.io` deleted; repo Settings → Pages → source None; `CNAME` file
removed from the repo (`v0.0.2`); the challenge TXT deleted in Cloudflare.
`gh-pages`, `predeploy`, `deploy` (old), `homepage` removed from `package.json`.

**Planned**: registrar transfer Squarespace → Cloudflare Registrar (Squarespace:
unlock domain, get the authorization code; Cloudflare: Domain Registration →
Transfer Domains → enter code → pay one year's wholesale renewal; approve the
transfer email so it completes in ~1h instead of 5 days). Afterwards delete
the `_domainconnect` CNAME and re-enable DNSSEC (Cloudflare manages the DS
record itself as registrar). Not urgent: DNS already lives on Cloudflare.

---

## 8. Releases & deploy

**`npm run deploy`** (`scripts/deploy.mjs`, tested against a throwaway repo
with a bare origin — 19 checks): refuses on a dirty tree, off `main`, or
behind `origin/main`; reads `version` from `package.json`; if tag
`v<version>` is unshipped (locally or on origin) uses it as-is (you set it by
hand); otherwise bumps the patch in `package.json` + `package-lock.json` and
commits; if the bumped tag exists too it stops rather than guess; tags
`v<version>` and pushes `main` + the tag. `npm run deploy:dry` prints the plan.
Git only — no npm shell-out (Node can't spawn `npm.cmd` without a shell on
Windows). No GitHub Actions.

**Order for schema changes**: `railway ssh` → `npm run db:migrate` (backs up
first) → `npm run db:inspect` → `npm run deploy`.

**Releases**: Evan set the version to `0.0.1` by hand → `v0.0.1` (first
production deploy). `v0.0.2` = retire GitHub Pages. `v0.0.3` = object server
sync (2026-09-09). Auto deploy had to be enabled on Railway before `v0.0.2`/
`v0.0.3` actually built (§6).

**A merge to remember**: local `main` was behind a remote "lint errors"
commit that added `@types/three ^0.170` and still had `gh-pages`; resolved as
ours + `@types/three`. `@types/three` 0.170 vs runtime three 0.157 lets
r159+ API use compile — it bit once (TrafficLights `updateRanges`; now
branches on `updateRange` vs `updateRanges`).

---

## 9. Assets / CDN — deferred

The plan: content-hashed uploads (`aws s3 sync` to a public Cloudflare R2
bucket on `cdn.dotcomma.io`, `Cache-Control: public, max-age=31536000,
immutable`), an `assets.json` map, one client resolver over
`REACT_APP_CDN_URL`, Draco/meshopt/KTX2 decoders, on-demand loading with
progress; the browser fetches assets directly from R2, never through Express.

What happened: an R2 bucket `dotcomma-assets` was created, then **deleted and
the R2 subscription cancelled** — with 13 assets totalling 12MB in `public/`
there was nothing to gain yet, and the client half (resolver, decoders,
progress) was judged to have no measurable benefit at this size (drei's
`useGLTF` already caches parsed models; terrain already has a progress gate).
Assets keep shipping in the CRA build from `public/`, served by Express with
the immutable header. `.env.example` keeps `REACT_APP_CDN_URL` and the R2
variables commented as FUTURE. No `aws` CLI was installed. Revisit as one
piece when there are enough models to warrant a bucket; decide compression
format and decoders together then.

---

## 10. Local development

```
npm install && (cd server && npm install)
npm run build                     # client → build/, server → server/dist/
(cd server && npm run db:migrate) # creates ./data/dotcomma.sqlite (schema 1)
npm run start:server              # http://localhost:8080 (built client + ws)
npm run dev                       # BOTH: server (tsx watch :8080) + client (craco :3000), prefixed output,
                                  #   Ctrl+C stops both; first run creates+migrates server/data/dotcomma.sqlite
                                  #   (scripts/dev.mjs; --no-open / --server-only / --client-only)
npm start                         # or separately: CRA dev server :3000 …
npm run dev:server                # … + tsx watch on :8080 (.env.development points the client at it)
(cd server && npm test)           # entity manager + real beeble machine
npm run deploy:dry / npm run deploy
npm run db:inspect [-- --id X]    # compiled CLI (build first); or from source inside server/
```

Env files: `server/.env` (PORT, DATABASE_PATH, DB_AUTO_MIGRATE,
DEBUG_DATA_WRITES), `.env` / `.env.development` (REACT_APP_*). Browser
console: `__net.state`, `__net.serverTime()`, `__net.setData({...})` (needs
`DEBUG_DATA_WRITES=1`), `__entities.list()`. Two tabs of one browser are two
sessions sharing one identity — the standard local multiplayer test.

---

## 11. Open items

1. Registrar transfer to Cloudflare, then delete `_domainconnect`, re-enable DNSSEC (§7).
2. Assets/CDN pipeline when the model count justifies it (§9).
3. ~~Server-side building avoidance for NPCs~~ — done: server physics (§5).
4. Player movement validation in `World.move` when PvP needs to be strict (§4).
5. `body: "dynamic"` for pushable objects (§5).
6. The real persistence schema: one migration + typed accessors (§3).
7. Align `@types/three` with runtime three 0.157 (§8).
8. Confirm Railway auto deploy fires on the next push; Eject from the upstream repo if not (§6).
9. Enable Railway volume backups if not already on (§6).
