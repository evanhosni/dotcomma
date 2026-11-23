# dotcomma

An exploration-based procedurally-generated 3D game on React Three Fiber: infinite terrain across diverse biomes, spawned NPCs and objects. Modular by design: new domains, regions, biomes, game objects and systems are added without touching core infrastructure.

> **Maintenance note:** NOT auto-updated: after adding systems, renaming directories or changing conventions or architecture, ask Claude to update it.

## Tech Stack

- **React 18** + **TypeScript** (strict mode); **Three.js** via `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier` (physics)
- **No router** — one page, one canvas
- **Craco** (CRA + webpack; `.glsl` files as raw assets)
- **Web Workers** for heavy computation (Voronoi/Delaunay, terrain data, tunnels)
- **Noise**: `noise-ts` (Simplex/Perlin), `seedrandom` (deterministic RNG); **Delaunator** for Voronoi diagrams

## Commands

- `npm run dev` — server + client together (`scripts/dev.mjs`: the server (esbuild watch + `node --watch`) on :8080 + craco on :3000; first run creates + migrates the local SQLite)
- `npm start` — client only (craco); `npm run dev:server` — server only
- `npm run build` — production build
- `npm test` — jest (headless: `$env:CI="true"; npm test -- --watchAll=false`)
- `npx tsc --noEmit` — type check

## Where the docs are

This file is the MAP (architecture, invariants, rules; it stays under ~40k characters). Each folder's `README.md` is the reference for its code; the RECORD OF DECISIONS (measurements, rejected approaches, the why behind every number) is the `DECISIONS.md` next to it. **Read the relevant one before changing a system, and put new measurements and rejected approaches THERE, never here.**

| system | decisions doc |
|---|---|
| height pipeline: blending, presence, one source of truth, flatten pads, voronoi caching, biome flags | [generation/](src/generation/DECISIONS.md) |
| freeway wall network, city terrain | [generation/roads/](src/generation/roads/DECISIONS.md) |
| rivers, lakes, shores, water, the flow | [generation/water/](src/generation/water/DECISIONS.md) |
| inter-city freeways, bridges, deck seams/mouths, lane ends, road fragments, block islands | [generation/bridges/](src/generation/bridges/DECISIONS.md) |
| domains, navigation, config commit, scope-aware components, addresses | [world/domains/](src/world/domains/DECISIONS.md) |
| terrain LOD cross-fade | [world/terrain/](src/world/terrain/DECISIONS.md) |
| game objects, actor spawn lifecycle | [objects/](src/objects/DECISIONS.md) |
| procedural buildings (interiors, doors, collider LOD) | [objects/actors/building/](src/objects/actors/building/DECISIONS.md) |
| lighting and VFX (lamp glow, curvature, spawn fade, nightfall hitch) | [vfx/](src/vfx/DECISIONS.md) |
| player movement (slopes, support, fall-through defenses, surface modifiers) | [physics/](src/physics/DECISIONS.md) |
| float64/float32 split, rebasing | [COORDINATE_PRECISION.md](COORDINATE_PRECISION.md) |
| every performance measurement, outrunning the generators | [PERFORMANCE.md](PERFORMANCE.md) |
| server, persistence, deploy, entity sync, server physics | [server/](server/DECISIONS.md) |
| caves, sewers, snow, rocks (tunnels, terrain holes, player underground) | [generation/underground/](src/generation/underground/DECISIONS.md) |

Also: [src/world/VERTEX_JOURNEY.md](src/world/VERTEX_JOURNEY.md) (one vertex through the pipeline and the shader), [NPC_TRACKING.md](NPC_TRACKING.md) (the NPC sync guide), `CHANGES.md` / `SERVER_CHANGES.md` (history logs).

## Architecture

### Content hierarchy — DOMAIN → REGION → BIOME, and the tree IS the world

**PRESENCE BY MOUNTING is the one rule.** A world is ONE JSX tree. React renders it for the player,
and a Three-free walker (`src/world/content/`) reads the SAME elements as data for the workers and
the server. A thing exists because a component is mounted; a knob is a prop; a part is a child.
There is no spec list beside the JSX, no `has_x` flag, no name→component registry: to remove the
sewers, delete `<Sewers>` from the biome.

```
<Domain>                       // one switchable world (home, overworld, 404)
  <Terrain seed .../>          //   its global terrain knobs over world/defaults.ts
  <Material riverTexture/>     //   the default riverbed texture
  <Skybox/>                    //   the default sky
  <PostProcessing/> <DayNightCycle/> <FastTravel/>
  <Water><WaterfallBoulders/><WaterfallSplashes/></Water>   //   THE BASE of all water (mesh, material, falls, default colours)
  <CityRegion/> <DesertRegion/> <SnowRegion/> <OceanRegion/>   // VORONOI ORDER (floor(u × count))

<Region id name>               // a group of biomes on one base terrain, under one base look and sky
  <Material shader textures/>  //   its BASE material — what a biome's own texture fades into at its edge
  <Noise params/>              //   its base relief
  <Skybox/>                    //   its sky, MIXED by position across region edges
  <Rivers chance={0.61}/>      //   rivers under it; no <Rivers/> = none
  <CityBiome/> <GrassBiome/>   // VORONOI ORDER

<Biome id name joinable weight blendWidth>   // everything true of one voronoi zone, as its children (weight: its roll share)
  <Material shader textures riverbed/>        // its fragment shader
  <Noise params offset><Dome/><Detail/></Noise>   // its relief (none = bespoke height code: the city)
  <Lake depth={26}><SeaweedField/><WaterBubbles/></Lake>   // a BODY of water: bowl + level (no road along its walls); its PARTS inside
  <Rivers chance={0}><Banks/></Rivers>         // overrides its region's prop by prop (0 = dry)
  <Pond kind={POND} standalone={0.5}><Actor actor={BEEBLE_SPEC} density={3000}/></Pond>   // point water (also on a region); every body takes the same parts
  <Sewers><Rooms><Actor actor={BEEBLE_SPEC}/></Rooms></Sewers>   // a feature, its part, what it places
  <Caves><Rooms>…</Rooms></Caves>
  <Snow/> <Rocks density={110}/>               // what lies on it
  <StreetLamps/> <RoadMarkers/> <TrafficLights/> <PowerLines/> <Bridges/>   // its dressing
  <GrassField .../>                            // its foliage
  <Actor actor={BUILDING_SPEC}/>               // what spawns on it, by density
  <Skybox/>                                    // an optional sky of its own
</Biome>
```

**How one tree serves three readers** (`src/world/content/`):
- A declaration is `declare({ kind, within, read?, View?, Driver? })`. `kind` is its tag in the
  walked tree; `within` is where it may be mounted (a dev throw otherwise); `read(node)` is its
  RESOLVED params for the config (its defaults applied, its children folded in); `View` is what
  React renders in its place; `Driver` is the ONE system mounted for it, whatever the mount count.
- A content file exports a static ELEMENT through `content(<Biome …>…</Biome>)`, never a function
  that builds one. **The walker never calls a component** — it reads `props.children` down the
  element objects — so a view with hooks in the tree is simply walked past.
- **The SERVER imports the same tree** (`world/domains/index.ts` → `DOMAIN_NODES`,
  `DOMAIN_CONFIGS`, `ACTOR_CATALOG`). Its build replaces three.js and R3F with a stub that answers
  anything (`server/build.mjs`), because nothing a view draws is ever CALLED there. **Every prop the
  config is built from must stay a literal** — a value computed from a three.js object would become
  a stub proxy in the server's config.
- A biome's features reach the pipeline as `SerializedBiome.features` (kind → resolved params).
  `generation/registry.ts` is generic over it; each system exports its own accessors beside its
  component (`snowBiomeIds()` lives with `<Snow/>`), so deleting a system deletes every mention.

**The hierarchy is also the FOLDER hierarchy** (`src/world/domains/<domain>/regions/<region>/biomes/<biome>/<Biome>Biome.tsx`): biome-specific code in the biome's folder, region-specific in the region's (`<Region>Region.tsx`, `shaders/base.glsl` = its BASE material), domain-specific in the domain's; only genuinely shared code lives above the domains. A REGION is partitioned by a voronoi grid above the biome grid (`regionGridSize` 3000 → biome `gridSize` 500). No edge, region or biome, is a hard boundary: height, material and sky cross-fade into the neighbor ("Blending"); rivers are the edges of their own grid and cross everything ("Rivers"). The overworld's four regions (city, desert, snow, ocean) are in regions/README.md.

**The three game-object classes** (`src/objects/`; the ATTRIBUTE HIERARCHY is `src/objects/types.ts`: `GameObjectAttributes` → `ActorAttributes` / `DressingAttributes` / `FoliageAttributes`, a field at the highest level two users share): **ACTORS** have their own identity, state or interaction (creatures, buildings), each a React component through the spawn lifecycle (`ActorPool`); a kind is ONE Three-free `ActorSpec` (`<actor>/spec.ts`), mounted as `<Actor actor={SPEC} …overrides/>`. **DRESSING** is mass stateless identical scenery per 256u chunk with zero per-object components. **FOLIAGE** is vegetation at ~32k instances per 64u chunk, streamed straight into GPU instance attributes. All three are placed off-thread and deterministically.

**ONE DRIVER PER KIND.** A dressing or particle feature mounted in a biome renders NOTHING: it
registers, and the single `Driver` `<Domain>` mounts draws every mount of that kind, because chunks
are world-space and a driver per mount would build each one twice. The driver reads its mounts with
`featureMounts(kind)` and takes the `farthest` view distance among them
(`objects/dressing/utils.ts`). The tunnels are the exception — their chunks are built per biome
cell and never overlap, so `<Caves/>`/`<Sewers/>` run one chunk lifecycle per biome.

**EVERY game object is built on its class's BASE, and each base owns ALL logic its members share** — structural, not stylistic: a world-wide effect (curvature, quantization, lamp glow, the spawn fade, the shared frame driver, GPU warm-up) is implemented ONCE per base and inherited by belonging to the class. An object that hand-rolls what its base does will silently miss the next one.

| class | base | what the base owns | a member is |
|---|---|---|---|
| ACTOR | `objects/actors/` (`hooks.ts`, `material.ts`, `store.ts`) | `useActorLifecycle` (ONE shared frame driver, spawn fade + despawn, frustum visibility + warm-up, distance-gated colliders with a global throttle, a "near" gate, matrix freezing) and `prepareActorMaterial` (quantization, lamp glow, curvature, spawn fade) | `<ModelActor>` (`model/`: pooled GLTF clone, colliders, animation LOD), or `useActorLifecycle` directly (`building/Building.tsx`) |
| DRESSING | `objects/dressing/` (`hooks.tsx`, `geometry.ts`) on `world/chunks/` | the 256u chunk lifecycle on one budgeted queue, chunk assets + `prepareChunkMaterial` (curvature, spawn fade, disposal), `instancedFromPoints` / `finalizeInstancedChunk` (assembly, rebase, bounds, warm-up), `useSolidDressing` (spec placement, distance-gated imperative colliders), `selfPatchedMaterial` | a folder: `<Component>.tsx` (declaration + driver), `spec.ts` (Three-free placement + colliders, shared with the server), its art |
| FOLIAGE | `objects/foliage/FoliageField.tsx` | the ENTIRE pipeline: chunks, worker streaming, the instanced billboard mesh and its shader (sway, fades, quantization, curvature, night dim), the distance LOD | `createFoliage({…})` with a plant's art + defaults (`grass/GrassField.tsx`) |

Rule of thumb: unique geometry, interaction or behavior → actor; many + identical + stateless → dressing; thousands-per-chunk vegetation → foliage. The PARTICLE base (`src/objects/particles/`: GPU-looped instanced quads, one clock uniform) is drawn by `createParticleDressing`, which returns a declaration like any other.

### Systems: the invariants (details and history in the decisions docs)

- **Domains share ONE page and ONE canvas.** No router: URL paths are fake (`pushState` only, `world/domains/navigation/`). `OverworldDomain` is THE game; every path that is an ADDRESS (`isKnownAddress`) boots it there; `HomeDomain` (`/`) is the landing page (its CRT drops the player into the overworld); every other path becomes `/404` (`NotFoundDomain`, a white void). A switch happens inside ONE persistent `<CustomCanvas>` in two phases (no domain, `resetDomainSystems()`, the new one); canvas, GL, programs, `<Physics>`, Player, contexts and overlays are never torn down. Per-domain scene state is a `<Domain>` prop (`playerSpawn`); the background is the domain `<Skybox>`'s horizon. `FastTravel.tsx` sets a spawn with a drop height; BACK fires the escape pod (`ESCAPE_POD_EVENT`). Home and 404 are flat terrain drawn as a wire grid. → domains/DECISIONS.md
- **The commit.** `<Domain>` walks its children ONCE and publishes the `DomainConfig`, the LOOK model, the skies and the actor descriptors (`world/domains/store.ts`: `getActiveDomainConfig()`, `getActiveRegions()`, `getActiveSkyboxes()`, `getActiveActors()`, `getTerrainParams()`, `await whenDomainReady()`), then mounts `TerrainRenderer`, `ActorPool`, `SkyboxSystem` and every `Driver` the tree asked for. `world/content/config/` is the ONE assembler — the server runs on the same object, so nothing drifts. `ACTOR_CATALOG` derives from the same trees (ids and names asserted unique). `Material`/`Skybox` mean what their parent says: under `<Domain>` the river-bed texture / default sky, under `<Region>` the BASE material / a sky mixed by region weights, under `<Biome>` the biome frag / a sky override. `Terrain` is domain-only.
- **Never a biome id or name.** Every biome difference a system keys on is a FEATURE it mounted — its resolved params land in `SerializedBiome.features` under the declaration's kind — never its id or shape (the bed's slope yield is a riverbed param; `<Quays/>` is how water knows the city). `generation/registry.ts` is generic over that map (`biomeIdsWith(kind)`, `biomeFeature(id, kind)`, `featureMounts(kind)`), and each system exports its own typed accessors beside its component, so deleting a system deletes every mention of it. The bespoke city height branch is the one id the pipeline names, and `roadBearingBiomeIds()` is where it becomes a question everything downstream can ask. → generation/DECISIONS.md
- **Addresses: the URL is a place.** `/<region words>/<biome words>` is a BIJECTIVE encoding of cell coordinates (never a hash or a registry). FROZEN: the word lists (append-only), the scramble constant, the seed, the region/biome order, the grid sizes; `world/domains/overworld/address/tests/address.test.ts` pins the vectors. Debug: `window.__dotcomma.travelTo(x, z)` (`travelTo(x, z, y)` lands at `y` with the terrain gate open: into a tunnel). → domains/DECISIONS.md
- **Blending: no boundary anywhere, ever.** Every zone wall cross-fades: heights on the CPU, the material per PIXEL, the sky by position. The shader gets per-biome-slot SIGNED DISTANCES (`biomeSdf`), never a weight or a biome id; indicators combine by CRISPNESS PRECEDENCE (`combineZoneWeights`); a biome fades into its region's BASE by `presence`; the feather uses the SMALLER side's width; widths resolve biome → region → domain. `biomeSdf`/`biomePresence` have their OWN buffers (the pad recursion clobbers the scratch); every vertex attribute is FINITE (`BIOME_SDF_FAR`): one Infinity vertex makes the triangle NaN. → generation/DECISIONS.md
- **Heights have a single source of truth:** `src/generation/index.ts` (`computeVertexData`, steps 0–14 in one order: VERTEX_JOURNEY.md). Every worker, the main thread (`world/terrain/utils.ts`) and the server run it. Biome heights come from the spec's `noise` (+ `detail` layers); bespoke biomes (city) have a branch in the pipeline. Never add a second height code path, and never read a height on a stepping thread (the ground's modifiers are sampled on a worker).
- **Flatten-ground pads** (`flattenGround: true`): placement is FULLY DETERMINISTIC (`generation/placement/flatten-pads/index.ts`), and both `applyFlattenPads` and spawn.worker consume it. Raw height is NOT a lower bound, because pads excavate, so any below-surface test must confirm with the padded height (`resolveEmbeddedSurface`). Far visual LODs skip pads. → generation/DECISIONS.md
- **Freeways live on the biome walls** (`getNetwork`, per cell, over a wide window, lazy via `networkOf(ctx)`). The city's BELT freeway is centered ON its wall, and runs start at the belt's wall junctions. → generation/roads/DECISIONS.md, generation/bridges/DECISIONS.md
- **Rivers are the edges of their OWN voronoi grid** (`generation/water/rivers/network/`), a pure function of position, so every chunk, worker and the server agree. Nothing is cut for a city: the city ADAPTS (quays, waterfront belt); where they conflict the road wins (suppressed stretches end bluntly). `riverFieldAt` runs FIRST in `computeVertexData` (building a river list evaluates terrain and clobbers the scratch). A river CARVES a gorge through a mountain under its `<Rivers maxCarve>` or across any gap ≤ `shortGap`; a longer gap between two waters is CLIMBED to a summit pond where a `<Pond summit>` rolls, else it ends (a `<Pond riverEnd>` pond, else round). The bed paint ends where the shader first hides it (`capRiverBed`). Physics does not know water. → generation/water/DECISIONS.md
- **Water is one hierarchy**: `<Water>` (domain) is the base; `<Lake depth>`, `<Rivers chance>`, `<Pond kind>` are BODIES on ONE base (`world/components/water/Water.tsx`), all taking the same PARTS, placed by ONE zone rule (`waterZoneOf`) where the body owns the vertex (`VertexResult.waterBody*`). Every knob is a prop, biome → region → `<Water defaults>` → default; water reads roads only via `generation/water/utils.ts`. Step 4 is ONE composition, `resolveWater`. Anything probing the world mid-vertex puts back the scratch it clobbers. → world/water/README.md
- **Lakes** are a biome with a `<Lake depth>` (`lakeOf`). Water never sits above its land, nor land below it (`landDeficitAt`, `shoreLift`). The water is a child mesh per chunk (per-vertex body colours), `WATER_RENDER_ORDER` (10), no depth. → generation/water/DECISIONS.md
- **Bridges are DRESSING, computed geometrically.** A deck exists only where a road genuinely crosses a river, landed on dry road at both ends, continuous with it; deterministic per window; colliders are a trimesh of exactly the drawn ribbon; the terrain is cut under the DRAWN slab; a vertex fetches its cell's decks FIRST (enumerating them evaluates terrain). Keep `WORLD_CHUNK_SIZE` consistent between client and server. → generation/bridges/DECISIONS.md
- **Tunnels (caves, sewers) are WORLD content and an OVERLAY** (`world/underground/`, a cut through the ground, not scenery on it): their one height step is the cave MOUTH BULGE (`generation/underground/index.ts`, step 10, from caves generated on the un-bulged ground). A cave ENTRANCE is ONE isosurface of ground and tunnel, drawn with the terrain material fading into rock; the terrain is cut per pixel there and at shafts (`world/shaders/terrain-holes/`). The player and every server NPC move by ONE rule set (`physics/tunnel-rules/`) on a `TunnelSpace` each: heightfields are ignored in a tunnel's air and a mouth's CUT, where the drawn entrance patch is the collider. Caves hold no water; manholes and doors are the SERVER's state. Snow is ONE rule for the sheet, the whitening and the wading; rocks a density field per biome plus every mouth's spots; river boulders are a part of `<Water>`. → generation/underground/DECISIONS.md
- **City terrain** (`generation/roads/city/`): rotated staggered DISTRICTS of square block grids (not voronoi), arterials on district boundaries; ONE normalized road field drives the shader bands, the curb dip, the spawn filters and every "is a road here" test (`cityConfig.roadWidth` 7 must match the city shader); a fully pairwise LINEAR chamfer; never paint from the phase varyings (`vFreewayAlong`, `vDistanceToFreewayCenter`) without the `fwidth()` guard. → generation/roads/DECISIONS.md
- **Coordinate precision:** generation is float64 on ABSOLUTE coordinates and is never rebased (every seed would change). Rendering is float32 and must never form an absolute world coordinate: build positions as rebase origin + offset, projected through `modelViewMatrix[3]` — every chunk-relative custom program does it through ONE GLSL function, `projectChunkLocal` (`world/shaders/material.ts`: the terrain, water, tunnels, snow, rocks, particles). Any world-space period read from `vWorldPosWrapped` must divide `WORLD_WRAP` (4200). `vWorldPosAbs` is for lighting and the terrain holes only. Every instanced dressing chunk goes through `finalizeInstancedChunk`. → COORDINATE_PRECISION.md
- **Workers** are initialized from the first committed config. A domain switch re-inits them by termination.

### Directory Layout

The map; each folder's README is the reference for its files (naming rules: Conventions).

```
src/
  index.tsx  boot: navigation + connection + ONE persistent <CustomCanvas>; renders DOMAIN_TREES[domain]
  generation/  THREE-FREE WORLD GENERATION (workers, main thread, server)  README
    index.ts  THE HEIGHT PIPELINE (computeVertexData + variants); store.ts (live DomainConfig);
              registry.ts (generic feature lookup); utils.ts (noise, warp); types.ts
    zones/ (voronoi, places, blend/)  placement/ (density grid, flatten-pads/)  cache/  drawn-ground/
    water/ (resolveWater; channel joins lakes ponds valleys parts rivers/)  roads/ (city freeways fragments dressing)
    bridges/ (chains rules crossings deck ground census)  underground/ (field caves sewers chunks)  snow/  rocks/
  objects/  THE GAME OBJECTS; types.ts = the attribute hierarchy  README
    actors/  base: hooks.ts (useActorLifecycle) material.ts store.ts spec.ts registry.ts
      model/ (ModelActor, clone pool, colliders/)  spawning/ (ActorPool, spawn.worker)  state/  beeble/  building/
    dressing/  base: hooks.tsx (useSolidDressing) geometry.ts (instancing) registry.ts (enumerators, collider specs)
      street-lamps/ road-markers/ traffic-lights/ power-lines/ bridges/ rocks/ snow-drift/ waterfall-boulders/
    foliage/  base: FoliageField.tsx (createFoliage) + foliage.worker; grass/ seaweed/
    particles/  base: ParticleDressing.tsx (createParticleDressing); pond-steam/ water-bubbles/ waterfall-splashes/
    doors/  the hinged door (buildings, sewers)   sprite-lod/  far billboards
  world/
    CustomCanvas.tsx (never torn down)  place/ (where the player is)  types.ts defaults.ts constants.ts  VERTEX_JOURNEY.md
    content/  THE TREE: index.ts (declare, content, the walker), config/ (THE DomainConfig assembler)
    components/  the declarations (Domain Region Biome Terrain Noise Material Actor …, water/ = the bodies); index.ts = barrel
    domains/  index.ts (DOMAIN_TREES/NODES/CONFIGS, ACTOR_CATALOG) store.ts (active domain) navigation/
      overworld/  OverworldDomain.tsx FastTravel.tsx address/ water/spec.ts
        regions/<r>/<R>Region.tsx + shaders/base.glsl + biomes/<b>/{<B>Biome.tsx, shaders/fragment.glsl}
      home/  HomeDomain.tsx crt/   404/  NotFoundDomain.tsx
    terrain/  TerrainRenderer.tsx, terrain.worker, material, build-requests/ chunk/ lod/ lod-swaps/
    shaders/  vertex.glsl common.glsl material.ts (chunk projection, fades) biome-materials/ terrain-holes/
    chunks/  THE 256u STREAMING GRID (hooks.ts: useWorldChunks …; types/constants Three-free, shared with the server)
    underground/  the tunnels: Caves Sewers Rooms .tsx, TunnelsDriver, underground.worker   water/  sky/
  animation/ (AnimationChannel, AnimationPlayer)  lighting/ (day-night lamp-glow personal-light)  physics/ (THE capsule
  resolver, movement-modifiers, tunnel-rules)  player/  net/ (protocol/ = THE wire copy)  context/  save/  menus/overlay/
  vfx/ (PostProcessing, material.ts patchers, spawn-fade/, screen-pass/ = THE post chain)
  utils/  utils.ts (reportContentError) math/ cursor/ task-queue/ spike-trace/ worker-client/ render/ (three: warm-up, freezing)
config/jest/rendererStub.js  what jest maps a worker client to
server/  src/{index.ts transport/ data/ game/ cli/}, tests/; build.mjs is THE build  README
```

### Terrain Pipeline

Player position → `computeDesiredChunks()` (quadtree LOD; the cave mouths' LOD1 sites) → `buildChunk()` → per vertex `computeVertexData` (every step and the shader's mix order: [`src/world/VERTEX_JOURNEY.md`](src/world/VERTEX_JOURNEY.md)) → buffers, normals, skirts, the water child mesh. LOD swaps CROSS-FADE (`LodSwapper`) with complementary screen-door dither; every chunk that needs a `discard` (mid-fade, in the far fade, touching a tunnel opening, or any while the player is in a tunnel) draws the ONE discard variant, the rest the base program. Every terrain program is ~0.6s of main-thread link in Firefox: add a variant only when no existing one can carry it. → terrain/DECISIONS.md

### Actor Spawn Lifecycle

`objects/actors/spawning/spawn.worker.ts` gives deterministic, cached spawn points; `ActorPool.tsx` mounts and unmounts them with radius hysteresis (immediate / spawn / despawn). Only REspawns are blocked inside the immediate radius (a 1s despawn ledger); nothing is permanently despawned, ids are position-based. → objects/DECISIONS.md

### Key Patterns

- **Utility namespaces** (material patchers + texture loading only): `_material.loadTextures()`, `_quantization`, `_curvature`. Math helpers are plain exports (`seedRand`, `smoothstep` from `utils/math/`; `seededStream` for many draws from one seed)
- **Worker clients extend `createWorkerClient`** (`utils/worker-client/index.ts`) and live at `<feature>/worker.ts` — never hand-roll a pending map / INIT handshake / terminate; a client file is only its typed request wrappers.
- **Density placement has ONE implementation** (`generation/placement/utils.ts`), shared by the spawn worker, the flatten-pad engine and the dressing worker (that is what keeps pads under buildings); a dressing placement names a `feature` instead of `biomeIds`, so the points stand in whichever biomes mounted it. `passesPlacementFilters` rejects every point within `riverKeepOff()` of a river for EVERY object.
- **Dev vs production is ONE flag**: `IS_DEV` (`src/utils/constants.ts`: any non-production build, dev and jest); never read `process.env.NODE_ENV` directly
- **Content mistakes are loud**: every check of a mount, shader or machine reports through `reportContentError` (`src/utils/utils.ts`: throws outside production, logs in it). Use it for any new check.
- **Biome shaders**: each biome/region fragment shader becomes a named function; `combineBiomeMaterials` mixes them per pixel from the `vBiomeSdf0/1` / `vBiomePresence0/1` varyings (no biome id in the shader); the vertex shader is shared
- **Geometry pooling**: `acquireGeometry()`/`releaseGeometry()` recycle BufferGeometry per LOD level
- **Voronoi caching**: grids, triangulations, wall lists and sites are memoized (on grid identity / per cell); never rebuild the wall arrays per vertex. → generation/DECISIONS.md
- **DomainConfig** (`world/content/config/`): the serializable config the workers and the server run on — regions and biomes (base noise, river chance, water, each biome's `features`, blend widths), the `<Terrain>` params, flatten descriptors (from the `<Actor>` mounts), city config

## Adding Content

Each flow's checklist lives in the README of the folder it touches; this table says where, and what it costs. Mistakes are LOUD in dev (`reportContentError`): a declaration mounted in the wrong parent, duplicate ids/names, shader clashes, bad state machines, unplaced server actors, unwarmed programs.

| to add | files | checklist |
|---|---|---|
| a biome | 2 new (`<Name>Biome.tsx`, `shaders/fragment.glsl`) + 1 line in its region | [regions](src/world/domains/overworld/regions/README.md) |
| a region | 2 new + its biomes + 1 line in the domain | same |
| a lake-type biome | a `<Lake depth>` in the biome (its parts inside it) | [water](src/world/water/README.md) |
| a pond kind (pond, spring) / a part of a body | a Three-free spec in `overworld/water/spec.ts` + `<Pond kind chances>` / any child in a body (`zone` prop) | same |
| a bespoke-height biome (like the city) | a biome with no `<Noise>` + a branch in the pipeline | [generation](src/generation/README.md) |
| rivers under a region or biome | `<Rivers chance>` in it (none in a region = none; a biome's overrides its region's, 0 = dry) | [generation/water/](src/generation/water/DECISIONS.md) |
| a static prop | 1 new (`spec.ts`) + `<Actor actor={SPEC}/>` in a biome (+ the GLB) | [actors](src/objects/actors/README.md) |
| an NPC | 2 new (`stateMachine.ts`, `spec.ts`) + `<Actor>` in a biome — mounting it IS cataloging it; nothing on the server | same, and [NPC_TRACKING.md](NPC_TRACKING.md) §6 |
| an NPC with scene logic | + 1 component registered in `ACTOR_COMPONENTS` / `ActorComponentName`, named by `component` on the spec; `withModelActorWarmup` | [actors](src/objects/actors/README.md) |
| a building variant | 2 edits: a spec in `building/spec.ts` + an `<Actor>` mount (flatten pads and the server's hull follow) | [building](src/objects/actors/building/README.md) |
| a far sprite | `spriteLod` on the spec + a describer + a `SpriteLook` | [sprite-lod](src/objects/sprite-lod/README.md) |
| tunnels under a biome | `<Caves>` / `<Sewers>` in it, `<Rooms>` inside, `<Actor>`s inside that; nothing else | [underground](src/world/underground/README.md) |
| snow / rocks on a biome | `<Snow/>` / `<Rocks …/>` in it | [snow-drift](src/objects/dressing/snow-drift/README.md), [rocks](src/objects/dressing/rocks/README.md) |
| a per-biome parameter of a feature | 1 field on its params type + its default in that feature's `params.ts` | [generation](src/generation/README.md) |
| a particle effect | a `ParticleLook` + a Three-free emitter enumerator (+ 1 `DRESSING_ENUMERATORS` line, a test) + 1 `createParticleDressing` member + 1 mount | [particles](src/objects/particles/README.md) |
| a plant | 1 new folder (`<Name>Field.tsx` = `createFoliage`) + 1 mount; its own `seed` | [foliage](src/objects/foliage/README.md) |
| a dressing feature | 1 new folder (`<Component>.tsx` = `declare({kind, within:"biome", read, Driver})`) + 1 mount; + an enumerator function, its re-export, one `DRESSING_ENUMERATORS` entry and a test | [dressing](src/objects/dressing/README.md) |
| …solid (client + server colliders) | + a Three-free `spec.ts` + 1 `DRESSING_COLLIDER_SPECS` line; the driver calls `useSolidDressing` | same |
| a skybox | 1 `<Skybox>` line in a domain, region or biome | [sky](src/world/sky/README.md) |
| a glow source / glow color | `registerLampHeads(...)` + its disposer / 1 `LAMP_COLORS` entry | [lighting](src/lighting/README.md) |
| an overlay | 1 new file (styles from `menus/overlay/constants.ts`) + 1 mount | [menus](src/menus/README.md) |
| a dev toggle | 1 `DEV_TOGGLES` entry | [context](src/context/README.md) |
| a saved field | 1 `SaveData` field + `saveToDevice`/`saveToAccount` | [save](src/save/README.md) |
| a world-wide VFX | a patcher in `vfx/` + a `<PostProcessing>` prop + a `VFX_KNOBS` entry (devmode's live slider) + the six class-base call sites | [vfx](src/vfx/README.md) |
| a network message | `net/protocol/types.ts` + server validation/handler + a client sender/listener | [net](src/net/README.md) |
| a domain (a separate page; today `home` and `404`) | 1 new `<Name>Domain.tsx` (its tree) + `DOMAIN_IDS` and `DOMAIN_TREES` entries + its path in `world/domains/navigation/index.ts` | [domains](src/world/domains/README.md) |

Rules no checklist can enforce:
- **Adding a region or a biome MOVES THE MAP.** The region roll is `floor(u × count)` over the `<Region>` children and the biome roll a cumulative pick by `<Biome weight>` (default 1) over each region's `<Biome>` children: appending one re-rolls every cell of that grid and every address. Inserting one with a small weight in the middle moves only the cells it takes (oasis: 11% of the desert). Do it before anyone has linked to an address, or accept it knowingly.
- **Two joinable biomes with the same `<Noise>` literal are ONE relief** (`generation/zones/blend/index.ts` `joinReliefs`): no wall between them fades it to the base.
- **Pick the object class first** (see "The three game-object classes"): lamps built as actors cost 10–20 fps.
- **A shared behavior goes in the class base**, never into one member; a new world-wide effect is applied from the bases only.
- **A biome shared by two regions** is its folder duplicated under the second region with a new element name and the SAME `id`; its visual children render once per copy, and the shader fades it into the base of only the FIRST region listing it (`biomeSlotRegionsOf`).
- **Blend widths have no upper limit.** Past ~250u a lone cell never reaches full presence at its centre: a softer, partly-blended biome, a valid look.

### Hard rules from measurements (numbers in PERFORMANCE.md and the decisions docs)

- Physics steps once per frame (`timeStep="vary"`). Never mount per-chunk/per-object `<RigidBody>`s: every collider is an IMPERATIVE Rapier body.
- Never add a `useFrame` to an actor: pass `onFrame` to `useActorLifecycle` (one shared driver). Never attach R3F pointer handlers to spawned actors.
- New mass content that can mount off-screen uses `uploadOnFirstDraw`; a new kind of drawn object adds its warm-up template (`warmPrograms`).
- Throttled per-N-frame work is phase-offset per instance; main-thread work goes through a TaskQueue (`addTask(task, { at })`), never a self-budgeted loop.
- Hot caches evict the oldest half, never `clear()`, and store their own coordinates. Keep the foliage worker's fade-key sort (`instanceCount` truncation depends on it). `scene.matrixAutoUpdate = false`: static content is frozen with `freezeStaticSubtree`, parent included. Generation is time-budgeted, nearest-first, and never waits for terrain.
- Player movement (`physics/index.ts`, shared with server NPCs): slope bands ≤ 25° / 25–45° / slide > 40°, ray-gated support, the ground's `MovementModifiers` (`physics/movement-modifiers/index.ts`: the snow's drag and traction, sampled OFF the stepping thread and handed in as `input.surface`, so server NPCs wade too; slope limits shift at most ±15°), terrain ignored only through `ignoreTerrain`. Never weaken the fall-through defenses (fall clamp, substepping, contact offset, the analytic backstop). → physics/DECISIONS.md
- LOD tiers are each a `renderDistance` under one spawn/despawn rule (`objects/actors/spawning/utils.ts`); past its own, an actor spawn-fades into its sprite (COMPLEMENTARY pixels). → building/DECISIONS.md
- Buildings are never without a collider (detail < 120u, a sealed convex hull beyond); an NPC frozen inside a far building is DELIBERATE. → building/DECISIONS.md
- Models are plain GLB with separate vertex buffers; `useGLTF` runs with Draco OFF, and a Draco model is a loud content error. → objects/DECISIONS.md

## UI / Overlay Styling

Every overlay follows the stats overlay's green-on-black terminal look from `src/menus/overlay/constants.ts` (`PANEL_STYLE`, `PANEL_CSS`, `FONT`, `HUD_COLOR`, `HUD_Z_INDEX`), never retyped ([src/menus/README.md](src/menus/README.md)).

## Conventions

- PascalCase for components/types/classes, camelCase for utilities/functions/properties
- SCREAMING_SNAKE_CASE for constants and enums
- **FOLDERS SAY THE FEATURE, FILES SAY THE ROLE — or name the ONE component/class they hold.**
  A folder (kebab-case) is one feature; a sub-feature with files of its own is a subfolder. Every
  source file is exactly one of:
  - **`PascalCase.tsx` / `.ts`**: ONE React component (a content declaration mounted as JSX counts:
    `StreetLamps.tsx`, `CityBiome.tsx`, `TerrainRenderer.tsx`) or ONE class (`TaskQueue.ts`,
    `LodSwapper.ts`), named exactly after it. There is no `index.tsx`.
  - **a role file** from this vocabulary, nothing else:

  | file | holds |
  |---|---|
  | `index.ts` | the feature's core logic / public API, never JSX (`world/components/index.ts` is the one barrel) |
  | `types.ts` | interfaces and type aliases |
  | `enums.ts` | closed sets: kind tags, id lists, `as const` name tables |
  | `constants.ts` | fixed numbers and strings |
  | `defaults.ts` | the values props/params fall back to |
  | `params.ts` | a content feature's kind, its defaults and its biome accessors (Three-free) |
  | `spec.ts` | a Three-free description shared with the server |
  | `utils.ts` | helper functions |
  | `hooks.ts` | React hooks (`hooks.tsx` when they render JSX) |
  | `context.ts` | React contexts |
  | `store.ts` | module-level live state with its getters/setters/subscriptions |
  | `registry.ts` | a name → member table, or the registry of live members |
  | `material.ts` / `geometry.ts` / `shapes.ts` | art: materials, GLSL chunks + uniforms / geometry / shape tables |
  | `worker.ts` / `<feature>.worker.ts` | its worker CLIENT (jest stubs `/worker$`: the name is load-bearing) / the THREAD beside it |
  | `stateMachine.ts` / `animations.ts` | an NPC's behavior machine / its procedural clips (beside its `spec.ts`) |
  | `tests/<subject>.test.ts` / `shaders/*.glsl` | tests, inside the feature they test / raw shader assets |

  So: `street-lamps/{StreetLamps.tsx, FreewayLamps.tsx, LampPosts.tsx, spec.ts, geometry.ts, material.ts}`,
  never `index.tsx` + `lampSpec.ts`. A file named after what it does (`flattenPads.ts`) is either merged
  into a role file or becomes its own feature folder (`placement/flatten-pads/index.ts`).
  Exceptions, kept on purpose: the server's CLI entries (`server/src/cli/<command>.ts`, named by their npm
  script), and six class files still lowercase because a case-only rename on this case-insensitive
  checkout must be done with `git mv` (`net/entities/posePlayback.ts`, `objects/actors/state/{input,motion}.ts`,
  `server/src/game/world.ts`, `server/src/game/physics/{physicsWorld,chunkGenerator}.ts`).
- **Comments are for what the code cannot say.** Prefer a descriptive name. A comment earns its place ONLY for a magic value (units, provenance), a non-obvious WHY (a rejected alternative, a measurement, an invariant another file depends on, a hazard) or genuinely confusing logic. Never restate the next line, narrate history or duplicate this file. When in doubt, cut it.
- **The horizontal plane is x/z, everywhere** — `y` is always height, inside 2D code too (voronoi, city grid, density placement, chunk offsets): `PointXZ` / `RectXZ` (`utils/math/types.ts`) and `ix/iz`, `dx/dz`, `sx/sz` names, never `THREE.Vector2` or `.y` for a horizontal coordinate. The ONLY `(x, y)` pair is the abstract 2D noise samplers (`simplex2`/`perlin2`/`terrainNoise` in `generation/utils.ts`), whose inputs are not world axes
- **Extend, don't duplicate**: every game object extends its CLASS BASE (`objects/actors/hooks.ts`, `objects/dressing/hooks.tsx`, `objects/foliage/FoliageField.tsx`) plus the shared attribute types (`objects/types.ts`); actor variants spread a base descriptor
- **The code comes first, never the world's numbers.** A refactor takes the cleanest design even when generation drifts (placements, layouts, censuses no longer bit-identical); never contort code to stay zero-diff. Numeric comparisons are diagnostics for accidental breakage only; what must hold is the LOOK (check before/after screenshots) and the invariants above. Still say so when a change moves the map (addresses, biome rolls).
- Keep biome implementations self-contained; don't add cross-biome dependencies
- Interfaces live in the nearest `types.ts` (world-level types in `src/world/types.ts`)

## Multiplayer server and entity sync

One Railway service runs `server/` (Node 24, Express + `ws`, `node:sqlite`) and serves the CRA build. Runtime deps are exactly `express` + `ws`; everything shared with the client (Rapier, delaunator, noise-ts, seedrandom) is BUNDLED from the ROOT install by esbuild, never a second copy. The server imports `src/`'s Three-free modules; the client never imports `server/`. `game/world.ts` talks to sockets only through an `Outbox` — the only abstraction; do not widen it. Ops runbook: `README.md` → "Server, database, deploy". Layout: [server/README.md](server/README.md), [src/net/README.md](src/net/README.md).

- Two ids: `identity` (persistent, localStorage) and `id` (the session). Presence is scoped per DOMAIN (rooms). Close the socket on `pagehide`. Never use per-frame React state for networking.
- The SERVER runs every actor's state machine from the same config the client has; no client owns anything; clients place entities by snapshot interpolation on the server clock (`src/net/entities/utils.ts`). Configs express motion only through `ctx.motion` and animation through `ctx.animation`, and guard anything scene-bound on `ctx.groupRef.current`. A synced NPC = `stateMachine.ts` + `spec.ts` + a biome `actors` entry; read [NPC_TRACKING.md](NPC_TRACKING.md) first.
- dotcomma.io runs the last DEPLOYED release: an uncommitted tree is only visible at localhost:3000.

→ [server/DECISIONS.md](server/DECISIONS.md)
