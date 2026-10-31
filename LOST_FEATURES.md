# Lost features

What the hierarchy refactor removed, and what it cost. Each entry says what is gone, why it went,
and what to do if you want it back. Nothing here was removed because it was broken — every one was
a capability traded for a simpler tree.

Measured: both typechecks clean, the client builds, 214/216 client tests and 44/44 server tests
pass. (The two failing client tests — `severedFreeways.test.ts` and `riverBed.test.ts` — were
already failing at the branch point and are untouched by this work.)

---

## 1. `prohibitRivers` — a biome rivers may not reach

**Gone:** the `prohibitRivers` biome flag, the `RIVER_BLOCK_PROHIBITED` verdict, the nine-probe
footprint test in `classifyRiverPieces`, and the `riversProhibitedSomewhere` gate.

**Why:** no biome has ever set it, so the rule never fired. Under the new presence rule a flag that
nothing mounts is just dead weight, and this one cost a branch in the hot per-piece loop.

**To get it back:** a `<NoRivers/>` declaration in the biome, read by `riverPieceRules.ts`. The old
probe ring is in git history (`riverPieceRules.ts`, before this refactor).

---

## 2. `<Dressing>` and `<Foliage>` grouping components

**Gone:** the two group wrappers whose props were defaults for the features inside them
(`<Dressing renderDistance={400}><StreetLamps/><RoadMarkers/></Dressing>`), and
`createDefaultsGroup` in `objects/utils.tsx`.

**Why:** a group was a third place a knob could come from (own prop → group → feature default). With
features mounted straight into a `<Biome>`, each one carries its own props and there is one place to
look. The grouping was also visual only — it never affected what was drawn.

**Cost:** setting one render distance for every dressing feature of a biome now means typing it on
each. There are at most six per biome.

**To get it back:** it would be a declaration whose `read` merges its props into each child's — the
walker already carries children, so it is a small change in `world/content/config.ts`.

---

## 3. Per-mount view distances for a feature drawn by one driver

**Changed, not gone:** two biomes mounting the same feature with different `renderDistance` now
share the LARGEST of them (`farthest` in `objects/dressing/utils.ts`), because world-space chunks
are built once for every mount together.

**Why:** a driver per mount would build each 256u chunk once per biome that asked for it.

**Cost:** none today (no feature is mounted in two biomes with different distances). `<Rocks/>` is
mounted in both tundra and mountain, but only with different PLACEMENT props, which stay per-biome.

**Note:** the tunnels (`<Caves/>`, `<Sewers/>`) are the exception and keep one chunk lifecycle per
biome, because their chunks are built per biome cell and never overlap.

---

## 4. The actor-spec duplicate-id scan

**Gone:** the server test that imported every `objects/actors/*/spec.ts` and asserted no two
exported specs share an id.

**Why:** it used a runtime directory scan plus dynamic `import()` of `.ts` paths, which only worked
under `tsx`. The server now runs from a bundle (see §7), where those paths do not exist.

**Still covered:** `actorCatalogOf` throws on two different specs under one id for every kind a
world actually mounts (`server/test/catalog.test.ts` asserts the catalog). Only an unplaced
duplicate would slip through, and an unplaced spec does nothing.

---

## 5. `river.defaultProbability`

**Gone:** the domain-level fallback river density for regions that set none.

**Why:** a region now has rivers because it mounts `<Rivers/>`, and a region without one has none.
A fallback would mean a region could get rivers it never asked for.

**Cost:** `<Rivers/>` with no `chance` means 1 (every eligible edge), not 0.45. Every region in the
overworld sets its own chance, so nothing moved.

---

## 6. `prohibitRoads` as a settable flag

**Changed, not gone:** it is now DERIVED — a biome with `<Water/>` prohibits roads along its walls.

**Why:** impassable ground was the only reason anything ever set it, and a flag beside `<Water/>`
could only ever disagree with it.

**Cost:** a biome that should refuse freeways without being water cannot say so. Add a
`<NoRoads/>` declaration if that comes up.

---

## 7. `tsx` as the server's dev and test runner

**Changed:** `npm run dev` and `npm test` in `server/` now go through `build.mjs` (esbuild) instead
of `tsx`. Dev is a watch build plus `node --watch dist/index.js`; tests bundle to `dist-test/` and
run with `node --test`.

**Why:** the server reads the client's content tree as data, and that tree's views import three.js.
The build replaces those packages with a stub (`build.mjs`); `tsx` has no equivalent hook.

**Cost:** a rebuild step (~1s) between editing and running, and stack traces point into the bundle
(source maps are on). One build path now serves dev, prod, tests and the bundle assertion.
