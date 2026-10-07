# dotcomma

An exploration-based procedurally-generated 3D game built on React Three Fiber. Players explore infinite terrain across diverse biomes and encounter spawned NPCs/objects. The codebase is designed to be modular — new domains, regions, biomes, game objects, and systems should be easy to add without touching core infrastructure.

> **Maintenance note:** This file is NOT auto-updated. When you add new systems, rename directories, change conventions, or make architectural changes, ask Claude to update CLAUDE.md to reflect them.

## Tech Stack

- **React 18** + **TypeScript** (strict mode)
- **Three.js** via `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier` (physics)
- **No router** — one page, one canvas; domain switching is client-side with fake `pushState` URL paths (`src/world/domains/navigation.ts`)
- **Craco** (CRA + webpack customization, `.glsl` files loaded as raw assets)
- **Web Workers** for heavy computation (Voronoi/Delaunay, terrain data)
- **Noise**: `noise-ts` (Simplex/Perlin), `seedrandom` (deterministic RNG)
- **Delaunator** for Voronoi diagrams

## Commands

- `npm run dev` — server + client together (`scripts/dev.mjs`: tsx watch on :8080 + craco on :3000, prefixed output, Ctrl+C stops both; first run creates + migrates the local SQLite)
- `npm start` — client dev server only (craco); `npm run dev:server` — game server only
- `npm run build` — production build
- `npm test` — jest tests (package.json sets `transformIgnorePatterns` so ESM deps — delaunator, robust-predicates, noise-ts — transform; run headless with `$env:CI="true"; npm test -- --watchAll=false`)
- `npx tsc --noEmit` — type check

## Where the docs are

This file is the MAP: architecture, invariants and rules. It is loaded into every Claude session, so it must stay under ~40k characters. Each folder's `README.md` is the reference for its code ("How it works" plus a "How to use/add" checklist; the map is under Directory Layout). The RECORD OF DECISIONS (measured results, rejected approaches, the why behind every number) lives in a `DECISIONS.md` next to the code. **Read the relevant one before changing a system, and put new measurements and rejected approaches THERE, never here**: a line here only states the rule and points to it.

| system | decisions doc |
|---|---|
| height pipeline: blending, presence, single source of truth, flatten pads, voronoi caching | [src/utils/workers/DECISIONS.md](src/utils/workers/DECISIONS.md) |
| freeway wall network, city terrain | [src/utils/workers/roads/DECISIONS.md](src/utils/workers/roads/DECISIONS.md) |
| rivers, lakes, shores, water | [src/utils/workers/rivers/DECISIONS.md](src/utils/workers/rivers/DECISIONS.md) |
| inter-city freeways, bridges, deck seams/mouths, lane ends, road fragments, block islands, decks vs ground | [src/utils/workers/bridges/DECISIONS.md](src/utils/workers/bridges/DECISIONS.md) |
| domains, navigation, config commit, scope-aware components, addresses | [src/world/domains/DECISIONS.md](src/world/domains/DECISIONS.md) |
| terrain LOD cross-fade | [src/world/terrain/DECISIONS.md](src/world/terrain/DECISIONS.md) |
| game objects, actor spawn lifecycle | [src/objects/DECISIONS.md](src/objects/DECISIONS.md) |
| procedural buildings (interiors, doors, collider LOD) | [src/objects/actors/building/DECISIONS.md](src/objects/actors/building/DECISIONS.md) |
| lighting and VFX (lamp glow, curvature, spawn fade, nightfall hitch) | [src/vfx/DECISIONS.md](src/vfx/DECISIONS.md) |
| player movement (slopes, support, fall-through defenses) | [src/physics/DECISIONS.md](src/physics/DECISIONS.md) |
| float64/float32 split, rebasing | [COORDINATE_PRECISION.md](COORDINATE_PRECISION.md) |
| every performance measurement, outrunning the generators | [PERFORMANCE.md](PERFORMANCE.md) |
| server, persistence, deploy, entity sync, server physics | [server/DECISIONS.md](server/DECISIONS.md) |

Also: [src/world/VERTEX_JOURNEY.md](src/world/VERTEX_JOURNEY.md) traces one vertex through the height pipeline and the terrain shader; [NPC_TRACKING.md](NPC_TRACKING.md) is the plain-language NPC sync guide; `CHANGES.md` / `SERVER_CHANGES.md` are history logs.

## Architecture

### Content hierarchy — DOMAIN → REGION → BIOME, everything is a component

```
<Domain>                     // one switchable world (home, overworld); global rulesets + systems
  <Terrain/>                 //   global terrain rules (seed, grid sizes, road noise, river config, city config, default blend widths)
  <Material/>                //   river BED texture (under every river channel)
  <Skybox/>                  //   default sky
  <PostProcessing/>          //   global post-processing
  <Regions specs components> // renders the domain's region spec list IN ORDER (= voronoi order; config.ts reads the same list); null = config-only
  <Region spec biomes>       // spec = id/name/baseNoise/blend widths/riverProbability/biome order; `biomes` = components by name
    <Material/>              //   its BASE material — what a biome's own texture fades into at the biome's edge (presence)
    <Skybox/>                //   its sky (mixed by position across region edges)
    <Biome spec>             // rendered by <Region> in spec.biomes order; spec: joinable, noise|water, blend widths, `actors`
      <Material/>            //   biome fragment shader (<Material shader textures>)
                             //   ACTOR class: per-object spawns (identity/state/interaction) are
                             //     DATA — spec.actors: [{ actor: ActorSpec, …overrides }], registered by <Biome>
      <Dressing>             //   DRESSING class: mass stateless scenery, instanced per chunk;
        <StreetLamps/>       //     group props (renderDistance) are shared defaults; children
        <RoadMarkers/>       //     take their placement knobs as props
      </Dressing>
      <Foliage>              //   FOLIAGE class: mass GPU vegetation (per-instance attributes,
        <GrassField/>        //     shader animation); same group-defaults pattern
      </Foliage>
      <Skybox/>              //   optional per-biome sky override
    </Biome>
  </Region>
</Domain>
```

**The hierarchy is also the FOLDER hierarchy** (`src/world/domains/<domain>/regions/<region>/biomes/<biome>/`): everything specific to a biome lives in that biome's folder, everything specific to a region in its region folder (`region.tsx`, `spec.ts`, `shaders/base.glsl` = the region's BASE material), domain in its domain folder (e.g. `CityLights` lives in the city biome's folder because only the city mounts it). Only genuinely shared/global code lives above the domains. A REGION is a group of biomes with its own base noise, base material, sky and `riverProbability`, partitioned by a voronoi grid above the biome grid (`regionGridSize` 3000 → biome `gridSize` 500). Nothing is larger than a region, and no edge — region or biome — is a hard boundary: terrain height, material and sky all cross-fade into the neighbor (see "Blending"); rivers are the edges of their own grid and cross everything (see "Rivers"). The overworld has four: **city** (city + grass biomes on the default base, grass base material, `riverProbability` 0.35), **desert** (dust + salt-flat biomes on their own simplex base, sand base, 0.15), **snow** (tundra + mountain on a slow perlin base, snow base, 0.55), **ocean** (lake biomes — bowls under a blended water level — on a near-flat base, wet-sand base, 0.6).

**The three game-object classes** (`src/objects/` — the ATTRIBUTE HIERARCHY is one file, `src/objects/types.ts`: `GameObjectAttributes` (every class — renderDistance, colliderDistance, quantization, placement filters `biomeIds`/`heightRange`/`slopeRange`/`roadDistanceRange`, density/footprint) → `ActorAttributes` / `DressingAttributes` / `FoliageAttributes` (what only that class has) → member attributes next to the member (`ModelActorAttributes` in `actors/ModelActor.tsx`: model, scale, collider options; `BuildingAttributes` in `actors/building/types.ts`: shell/window/interior knobs). A field lives at the highest level where at least two users share it): **ACTORS** are objects with their own identity, state, or interaction — creatures, buildings — each mounted as its own React component through the spawn lifecycle (`ActorPool`); a kind is ONE Three-free `ActorSpec` (`<actor>/spec.ts`: model/placement/simulation knobs + the member `component` name), `describeActor(spec)` is its descriptor (`ActorDescriptor<ItsAttributes>`), and every attribute on it is forwarded to each instance as props (`ActorProps<A>` — minus the spawn-only ones in `SPAWN_ONLY_KEYS`, one list driving both the `Omit` type and the pool's runtime strip), so a member's knobs are set on the spec and overridden per biome mount (`BiomeSpec.actors`). **DRESSING** is mass stateless identical scenery — street lamps, road markers, traffic lights, power lines — rendered as InstancedMeshes per 256u chunk with zero per-object components. **FOLIAGE** is vegetation at another order of magnitude — up to ~32k instances per 64u chunk, placement streamed as Float32Arrays straight into GPU instance attributes, animation (billboarding/sway) in the vertex shader. All three get off-thread deterministic placement (spawn.worker / dressing.worker / foliage.worker).

**EVERY game object is built on its class's BASE, and each base owns ALL logic its members share** — this is structural, not stylistic: a world-wide effect (world curvature, vertex quantization, lamp glow, the spawn fade-in, the shared frame driver, GPU warm-up) is implemented ONCE per base and inherited by belonging to the class. An object that hand-rolls what its base does will silently miss the next one.

| class | base | what the base owns | a member is |
|---|---|---|---|
| ACTOR | `objects/actors/Actor.tsx` | `useActorLifecycle` (ONE shared frame driver, the single 2D squared distance, spawn fade-in (+ fade-out for `fadeOut` actors) + hard-kill despawn, frustum visibility + warm-up, distance-gated colliders with hysteresis and a global activation throttle, a "near" gate for dynamic content, matrix freezing) and `prepareActorMaterial` (quantization + lamp glow + curvature + spawn fade) | `<ModelActor>` (`actors/ModelActor.tsx`, the standard GLTF actor: pooled clone, its colliders, animation LOD) — or, for actors that own their geometry and render shape, `useActorLifecycle` directly (`Building`) |
| DRESSING | `objects/dressing/Dressing.tsx` | `useDressingChunks` (camera-following 256u chunk lifecycle on one budgeted queue), `useDressingAssets` + `prepareDressingMaterial` (creation, curvature, spawn fade, disposal; each chunk fades in as it is added), `instancedFromPoints` / `finalizeInstancedChunk` (assembly + far-from-origin rebase + culling bounds + warm-up), `useSolidDressing` (a collider feature's chunks, spec placement, bodies and distance-gated imperative colliders, wired once) | a component with ONLY its own geometry/materials, its placement (an enumerator name + args, or its collider spec) and optional animation (`StreetLamps`/`FreewayLamps`, `RoadMarkers`, `TrafficLights`, `PowerLines`, `Bridges`) |
| FOLIAGE | `objects/foliage/Foliage.tsx` | the ENTIRE pipeline — chunk lifecycle, worker streaming, the instanced billboard mesh, the shader (billboarding, sway, per-instance distance fade, quantization, curvature, spawn fade per chunk, night dim), the distance LOD, disposal | `createFoliage({…})` with a plant's art + defaults; every knob stays overridable at the mount (`grass/GrassField.tsx` is ~60 lines) |

Rule of thumb: unique geometry, interaction, or behavior → actor; many + identical + stateless → dressing; thousands-per-chunk vegetation → foliage. Both `<Dressing>`/`<Foliage>` group components come from one defaults-group factory (`src/objects/utils.tsx`).

### Systems: the invariants (details and history in the decisions docs)

- **Domains share ONE page and ONE canvas.** There is no router: URL paths are fake (`pushState` only, `src/world/domains/navigation.ts`). `OverworldDomain` is THE game, one infinite map, and every path except `/` is an ADDRESS inside it. `HomeDomain` (`/`) is the landing page. A domain switch happens inside ONE persistent `<CustomCanvas>` in two phases: render no domain, run `resetDomainSystems()`, then mount the new one. The canvas, GL context, compiled programs, `<Physics>`, Player, GameContext and overlays are never torn down. Per-domain scene state is a `<Domain>` prop (`background`, `playerSpawn`). Travel within the overworld is a TELEPORT (`ADDRESS_TRAVEL_EVENT` → `FastTravel.tsx`). The browser BACK button fires the escape pod (`ESCAPE_POD_EVENT`), and it can never unload the game. Home invariants: it passes `terrain={false}` but still commits the flat config (keep its `<Terrain>` and home region); its CRT glow light is parked at intensity 0 from mount; `ClickToEnter` must `stopPropagation` and dispatch a synthetic document click. → domains/DECISIONS.md
- **Config commit.** Config components (`src/world/components/`, plus `Skybox` in `src/world/sky/`) register during layout effects. `<Domain>` commits a plain `Region[]` + serializable `DomainConfig` to the active-domain accessors (`src/world/domains/utils.ts`: `getActiveRegions()`, `getActiveDomainConfig()`, `getTerrainParams()`, `await whenDomainReady()`) and mounts `TerrainRenderer`, `ActorPool` and `SkyboxSystem`. `<Region spec>`/`<Biome spec>` register the whole spec. `<Regions>`/`<Region biomes>` render their component maps IN SPEC ORDER and dev-throw on a mismatch. `overworld/config.ts` builds the SAME config from the same specs for the server, and the commit console.errors in dev when the two differ. `ACTOR_CATALOG` is derived from `DOMAIN_REGIONS`. `assembleDomainConfig` asserts unique region/biome ids and names. `Material`/`Skybox` are scope-aware:
  - under `<Domain>`: the river-bed texture / the default sky
  - under `<Region>`: the BASE material / a sky mixed by region weights
  - under `<Biome>`: the biome frag / a sky override

  `Terrain` is domain-only.
- **Addresses: the URL is a place.** The path is `/<region words>/<biome words>`, a BIJECTIVE encoding of cell coordinates (never a hash, never a registry). FROZEN: the word lists (append-only), the scramble constant, the seed, the region/biome order and the grid sizes. `address.test.ts` pins the vectors. Debug: `window.__dotcomma.travelTo(x, z)`. → domains/DECISIONS.md
- **Blending: no boundary anywhere, ever.** Every zone wall cross-fades: heights on the CPU, the material per PIXEL, the sky by position.
  - The shader gets per-biome-slot SIGNED DISTANCES (`biomeSdf`), never a per-vertex weight and never a biome id.
  - Indicators combine by CRISPNESS PRECEDENCE (`combineZoneWeights`), never by plain normalization.
  - A biome fades into its region's BASE by `presence`.
  - The material feather uses the SMALLER side's width.
  - Only LOD3–5 clamp the blend fields.
  - `biomeSdf`/`biomePresence` are returned in their OWN buffers, because the pad recursion clobbers the scratch.
  - Widths resolve biome → region → domain default.
  - Every vertex attribute is FINITE (`RIVER_BED_FAR`, `BIOME_SDF_FAR`): one Infinity vertex makes the whole triangle NaN, and Metal's fast-math compares took it as true (the Mac's dark seam triangles).

  → workers/DECISIONS.md
- **Heights have a single source of truth:** `src/utils/workers/vertexCompute.ts` (`computeVertexData`). Every worker, the main thread (`world/terrain/vertexData.ts`) and the server run it. Biome heights come from the spec's `noise`; bespoke biomes (city) have a branch in the pipeline. Never add a second height code path.
- **Flatten-ground pads** (`flattenGround: true`): placement is FULLY DETERMINISTIC (`utils/workers/flattenPads.ts`), and both `applyFlattenPads` and spawn.worker consume it. Raw height is NOT a lower bound, because pads excavate, so any below-surface test must confirm with the padded height (`resolveEmbeddedSurface`). Far visual-only LODs skip pads. → workers/DECISIONS.md
- **Freeways live on the biome walls** (`getNetwork`, per cell, over a wide window, lazy via `networkOf(ctx)`). The city's BELT freeway is centered ON its wall, and runs start at the belt's wall junctions. → roads/DECISIONS.md, bridges/DECISIONS.md
- **Rivers are the edges of their OWN voronoi grid** (`rivers/riverNetwork.ts`), a pure function of position, so every chunk, worker and the server agree.
  - Nothing is cut for a city: the city ADAPTS (quays, waterfront belt).
  - Where they conflict, the road wins: suppressed stretches end bluntly.
  - `riverFieldAt` runs FIRST in `computeVertexData`, because building a river list evaluates terrain and clobbers the scratch.
  - Physics does not know water.

  → rivers/DECISIONS.md
- **Lakes** are a biome with `water: { depth }`. The level is blended by a kernel. Land near water never sits below it (`shoreLift`). The water is a child mesh per terrain chunk. → rivers/DECISIONS.md
- **Bridges are DRESSING, computed geometrically.** A deck exists only where a road genuinely crosses a river, landed on dry road at both ends, continuous with it and reading as it. The decision is deterministic per window. Colliders are a trimesh of exactly the drawn ribbon. The terrain is cut under the DRAWN slab. A vertex fetches its cell's decks FIRST, because enumerating them evaluates terrain. Keep `DRESSING_CHUNK_SIZE` consistent between client and server. → bridges/DECISIONS.md
- **City terrain** (`roads/cityTerrain.ts`):
  - Rotated staggered DISTRICTS, each holding a square block grid (not voronoi), with arterials on the district boundaries.
  - ONE normalized road field drives the shader bands, the curb dip and the spawn filters. `cityConfig.roadWidth` (7, the half-width) must match the city shader's bands.
  - A fully pairwise LINEAR chamfer.
  - The phase varyings (`vFreewayAlong`, `vDistanceToFreewayCenter`) jump at seams: never paint from them without the `fwidth()` guard.

  → roads/DECISIONS.md
- **Coordinate precision:** generation is float64 on ABSOLUTE coordinates and is never rebased (every seed would change). Rendering is float32 and must never form an absolute world coordinate: build positions as rebase origin + offset, projected through `modelViewMatrix[3]`. Any world-space period read from `vWorldPosWrapped` must divide `WORLD_WRAP` (4200). `vWorldPosAbs` is for lighting only. Every instanced dressing chunk goes through `finalizeInstancedChunk`. → COORDINATE_PRECISION.md
- **Workers** are initialized from the first committed config. A domain switch re-inits them by termination.

### Directory Layout

Every folder below with a README has a "How it works" and a "How to use/add" section: the README is the reference for its files, this tree is the map. The decisions and measurements behind each system are in the sections above and below.

```
src/
  index.tsx              boot: navigation + connection + ONE persistent <CustomCanvas>; mounts DOMAIN_COMPONENTS[domain]
  objects/               THE GAME-OBJECT HIERARCHY                                       objects/README.md
    types.ts             GameObjectAttributes → Actor/Dressing/FoliageAttributes
    utils.tsx            createDefaultsGroup (<Dressing>/<Foliage> group defaults), definedOnly
    actors/              ACTOR class: Actor.tsx = THE BASE (useActorLifecycle, prepareActorMaterial)  actors/README.md
      ModelActor.tsx     the standard GLTF member (+ the behavior wiring for any spec with a stateMachine)
      spec.ts            ActorSpec / ActorMount (Three-free); catalog.ts = actorCatalogOf; components.ts = ACTOR_COMPONENTS
      modelClonePool.ts, animationPlayer.ts, kinematicMover.tsx
      spawning/          ActorPool, spawnWorker (client), collectDescriptors, types        spawning/README.md
      state/             the Three-free state machine core + motion/animation/input channels  state/README.md
      colliders/         GLTF colliders + collider.worker                                   colliders/README.md
      beeble/            the template NPC: spec.ts + stateMachine.ts (+ inflate.ts, its ascend morph)
      building/          procedural buildings: generatePlan → buildingAssets (cache + phased builds;
                         exterior/interiorGeometry, buildingGeometry, buildingMaterials) → Building  building/README.md
    dressing/            DRESSING class: Dressing.tsx = THE BASE (useDressingChunks, useDressingAssets,
                         instancedFromPoints/finalizeInstancedChunk); dressingColliders.tsx = useSolidDressing
                         + the distance-gated collider bodies                                dressing/README.md
      enumerators.ts     DRESSING_ENUMERATORS (name → placement); catalog.ts = DRESSING_COLLIDER_SPECS; types.ts (Three-free)
      street-lamps/ road-markers/ traffic-lights/ power-lines/ bridges/   one folder + README per feature
    foliage/             FOLIAGE class: Foliage.tsx (pipeline + createFoliage), foliageLod.ts (bands,
                         taper), foliageMaterial.ts (the shader)                             foliage/README.md
      grass/GrassField.tsx  the one plant
  world/
    CustomCanvas.tsx     THE canvas (GL context, <Physics>, Player, contexts — never torn down)
    types.ts, defaults.ts, constants.ts (CITY_BIOME_ID only)
    VERTEX_JOURNEY.md    one vertex from chunk request to pixel, every step in order
    components/          the declarative API: Domain, Regions/Region, Biome, Terrain, Material, Actor  components/README.md
    domains/             DOMAIN → REGION → BIOME content                                    domains/README.md
      navigation.ts, reset.ts, utils.ts (active-domain accessors), domainConfig.ts + buildDomainConfig.ts
      configs.ts         DOMAIN_REGIONS, DOMAIN_CONFIGS (the server's copy), ACTOR_CATALOG
      components.ts      DOMAIN_COMPONENTS
      overworld/         THE game: domain.tsx, config.ts, address.ts, FastTravel.tsx         overworld/README.md
        regions/         index.ts = OVERWORLD_REGIONS; city/ desert/ snow/ ocean/ — region.tsx + spec.ts +
                         shaders/base.glsl + biomes/<b>/{biome.tsx, spec.ts, shaders/fragment.glsl}  regions/README.md
      home/              the landing page: HomeGround, CrtMonitor + crtScreen, ClickToEnter  home/README.md
    terrain/             TerrainRenderer (chunk lifecycle), buildRequests (pipelined/prefetched requests),
                         chunkObjects (plane, water, colliders), chunkGeometry, terrainWorker (pool of ≤2),
                         lodConfig, lodQuadtree, lodSwaps + chunkIndex, material.ts, vertexData.ts  terrain/README.md
    shaders/             vertex.glsl, common.glsl, combineBiomeMaterials.ts, lodFade.ts, constants.ts (WORLD_WRAP)   shaders/README.md
    water/               waterMaterial.ts                                                   water/README.md
    sky/                 Skybox (+ SkyboxSystem), DayNightCycle + celestialBodies           sky/README.md
  lighting/              dayNight.ts channels, DayNightLights, lampGlow (the glow grid)     lighting/README.md
  physics/               characterMovement.ts — THE capsule resolver (player + server NPCs) physics/README.md
  player/                Player.tsx, groundSafetyNets.ts (backstop, stuck escape), useInput.tsx, spec.ts,
                         constants.ts (CAMERA_FAR)                                          player/README.md
  net/                   protocol.ts (THE wire copy), connection, playerData, players/, entities/  net/README.md
  context/               GameContext, DevContext, constants.ts (DEV_TOGGLES)                context/README.md
  menus/overlay/         StatsOverlay, DevOverlay, LogsOverlay, NetOverlay, styles.ts            menus/README.md
  vfx/                   PostProcessing, curvature, quantization, spawnFade, dither, frameCap,
                         materialPatch (chainMaterialPatch, shared by every patcher)        vfx/README.md
  utils/                 _math (seedRand), TaskQueue, warmPrograms, uploadOnFirstDraw, contentError,
                         spikeTrace, _material (texture loading, fromShader), cursor             utils/README.md
    workers/             THE HEIGHT PIPELINE (vertexCompute.ts + modules, rivers/ roads/ bridges/)
                         + the terrain/spawn/foliage/dressing workers + workerClient         workers/README.md
server/                  the game server (bundled; imports src/'s Three-free modules)       server/README.md
NPC_TRACKING.md          how NPCs sync, and how to write one
CHANGES.md, SERVER_CHANGES.md  history logs
```

### Terrain Pipeline

1. Player position → `computeDesiredChunks()` (quadtree LOD)
2. New chunks queued → `buildChunk()` async generator
3. Per-vertex: `computeVertexData` (or its raw/far variants). The full ordered journey of one vertex — every height step (warp, zones, city, lakes/shore, river carve, freeway grade, pads, deck cut, fragments), what each overrides, the uploaded attributes and the fragment shader's mix order — is [`src/world/VERTEX_JOURNEY.md`](src/world/VERTEX_JOURNEY.md)
4. Geometry buffers written, normals computed, skirt vertices set
5. LOD swaps CROSS-FADE (`lodSwaps.ts`): the old and new chunks are drawn together with a complementary screen-door dither, and only fading chunks use the `discard` FADE TWIN material. Colliders keep their own lifecycle. → terrain/DECISIONS.md

### Actor Spawn Lifecycle

`spawn.worker.ts` gives deterministic, cached spawn points. `ActorPool.tsx` mounts and unmounts them with radius hysteresis (immediate / spawn / despawn radius). Initial spawns have no inner exclusion zone; only REspawns are blocked inside the immediate radius (a 1s despawn ledger). Nothing is permanently despawned, and ids are position-based. Dressing has its own chunk lifecycle (`Dressing.tsx`). → objects/DECISIONS.md

### Key Patterns

- **Registration effects use stringified deps** — inline object props (noise params, descriptors) are registered under `JSON.stringify` deps so parent re-renders don't re-commit the domain.
- **Utility namespaces** (material patchers + texture loading only): `_material.loadTextures()`, `_quantization`, `_curvature`. Math helpers are plain exports (`seedRand`, `smoothstep` from `utils/math/_math.ts`)
- **Worker clients extend `createWorkerClient`** (`utils/workers/workerClient.ts`) — never hand-roll a pending map / INIT handshake / terminate; a client file is only its typed request wrappers. Workers construct lazily (the collider worker no longer boots at module import).
- **Density placement has ONE implementation** (`utils/workers/densityGrid.ts`); the spawn worker, flatten-pad engine and dressing worker call it — that is what keeps pads under buildings. `passesPlacementFilters` also rejects every point within `riverKeepOff()` (channel + banks) of a river for EVERY object — the quay strip's capped field sat inside the lamp band, so lamps stood on the sand and in the water.
- **Plain utility exports**: `getAllBiomes()`, `getDistance2DSq()`, `framePhaseFromCoords()`, `freezeStaticSubtree()` from `src/utils/utils.ts`
- **Content mistakes are loud**: every check of a spec, mount, shader or machine reports through `reportContentError` (`src/utils/contentError.ts`) — it throws outside production and logs in production. Use it for any new check.
- **Biome shaders**: each biome/region fragment shader becomes a named function; `combineBiomeMaterials` mixes them per pixel from the `vBiomeSdf0/1` / `vBiomePresence0/1` varyings (there is no biome id in the shader); the vertex shader is shared
- **Geometry pooling**: `acquireGeometry()`/`releaseGeometry()` recycle BufferGeometry per LOD level
- **Voronoi caching**: grids, Delaunay triangulations, wall lists and sites are memoized (on grid identity / per cell). Never rebuild the wall arrays per vertex: that was the dominant chunk-build cost. → workers/DECISIONS.md
- **DomainConfig**: serializable config sent to workers (`buildDomainConfig(regions, params)`, `world/domains/buildDomainConfig.ts`) containing region/biome data (with per-region base noise + riverProbability, per-biome water, per-level blend widths), global terrain params (from the domain-level `<Terrain>` — incl. the river config), per-biome noise (from the biome spec's `noise`), flatten descriptors (from the biome specs' `actors`), and city config

## Adding Content

Each flow's step-by-step checklist lives in the README of the folder it touches; this table says where, and what it costs. Mistakes in every flow are LOUD in dev (`reportContentError`, `src/utils/contentError.ts`: it throws outside production and logs in production): a spec list that disagrees with its component map, duplicate ids/names, a biome shader uniform or helper clash, an unknown state-machine trigger or target, two actor specs under one id, a server-simulated actor no domain places, a model actor without a `model`, a plant seed shared by two plants, an unwarmed program a dressing chunk draws.

| to add | files | checklist |
|---|---|---|
| a biome | 3 new (`spec.ts`, `shaders/fragment.glsl`, `biome.tsx`) + 2 one-line edits (the region's spec list and component map) | [regions/README.md](src/world/domains/overworld/regions/README.md) |
| a region | 3 new + its biomes + 2 one-line edits (`OVERWORLD_REGIONS`, the domain's component map) | same |
| a lake-type biome | a biome with `water: { depth }` | [water/README.md](src/world/water/README.md) |
| a bespoke-height biome (like the city) | a biome without `noise` + a branch in the pipeline | [workers/README.md](src/utils/workers/README.md) |
| a static prop | 1 new (`spec.ts`) + 1 line in a biome spec's `actors` (+ the GLB) | [actors/README.md](src/objects/actors/README.md) |
| an NPC | 2 new (`stateMachine.ts`, `spec.ts`) + 1 line in a biome's `actors` — placing it IS cataloging it; nothing on the server | same, and [NPC_TRACKING.md](NPC_TRACKING.md) §6 |
| an NPC with scene logic | + 1 component, 2 registration lines (`ACTOR_COMPONENTS`, `ActorComponentName`), `component` on the spec; `withModelActorWarmup` | [actors/README.md](src/objects/actors/README.md) |
| a building variant | 2 edits: a spec in `building/spec.ts` + a biome mount (flatten pads and the server's hull follow) | [building/README.md](src/objects/actors/building/README.md) |
| a plant | 1 new (`<Name>Field.tsx` = `createFoliage`) + 1 mount; its own `seed` | [foliage/README.md](src/objects/foliage/README.md) |
| a dressing feature | 1 new component + 1 mount (density-placed); + an enumerator function, its re-export, one `DRESSING_ENUMERATORS` entry and a test (structured) | [dressing/README.md](src/objects/dressing/README.md) |
| …solid (client + server colliders) | + a Three-free `*Spec.ts` + 1 `DRESSING_COLLIDER_SPECS` line; the component calls `useSolidDressing`; placement lives in the spec only | same |
| a skybox | 1 `<Skybox>` line in a region or biome | [sky/README.md](src/world/sky/README.md) |
| a glow source / glow color | `registerLampHeads(...)` + its disposer / 1 `LAMP_COLORS` entry | [lighting/README.md](src/lighting/README.md) |
| an overlay | 1 new file (styles from `menus/overlay/styles.ts`) + 1 mount | [menus/README.md](src/menus/README.md) |
| a dev toggle | 1 `DEV_TOGGLES` entry | [context/README.md](src/context/README.md) |
| a CRT page | 1 `EXTRA_PAGES` line (a region's page is automatic) | [home/README.md](src/world/domains/home/README.md) |
| a world-wide VFX | a patcher in `vfx/` + a `<PostProcessing>` prop + the five class-base call sites | [vfx/README.md](src/vfx/README.md) |
| a network message | `protocol.ts` + server validation/handler + a client sender/listener | [net/README.md](src/net/README.md) |
| a domain (a genuinely separate page — today only `home`) | `domain.tsx` + its regions + `DOMAIN_IDS`, `DOMAIN_COMPONENTS`, `DOMAIN_REGIONS` entries (the compiler asks for the last two) + its path in `navigation.ts` | [domains/README.md](src/world/domains/README.md) |

Rules no checklist can enforce:
- **Adding a region or a biome MOVES THE MAP.** The region roll is `floor(u × count)` over `OVERWORLD_REGIONS` and the biome roll over each region's `biomes`, so appending one re-rolls every cell of that grid and every address points somewhere else. Do it before anyone has linked to an address, or accept it knowingly.
- **Pick the object class first** (see "The three game-object classes"): lamps built as actors cost 10–20 fps.
- **A shared behavior goes in the class base**, never into one member; a new world-wide effect is applied from the bases only.
- **A biome shared by two regions** is its folder duplicated under the second region with a new component name, the SAME `id`, and a RE-EXPORT of the original spec (registrations merge by id; two names on one id throw). Its visual children (grass, dressing) render once per copy, and the shader fades it into the base of only the FIRST region that lists it (`biomeSlotRegionsOf`, `zoneBlend.ts`).
- **Blend widths have no upper limit.** A width past ~250u (half a biome cell) only means a lone cell never reaches full presence at its centre — a softer, partly-blended biome, which is a valid look (grass and dust inherit the 300 default). Measured on the old mountain: a 450u feather capped its peaks at half height; mountains now drive height from `dome` depth instead, so this no longer constrains them.

### Hard rules from measurements (numbers and history in PERFORMANCE.md and the decisions docs)

- Physics steps once per frame (`timeStep="vary"`). Never go back to a fixed step without driving kinematic bodies from it.
- Never mount per-chunk/per-object `<RigidBody>`s: terrain heightfields, dressing colliders, NPC capsules and building proxies are IMPERATIVE Rapier bodies.
- Never add a `useFrame` to an actor: pass `onFrame` to `useActorLifecycle` (one shared driver). Never attach R3F pointer handlers to spawned actors.
- Mass scenery is dressing, never actors (lamps as actors cost 10–20 fps).
- New mass content that can mount off-screen uses `uploadOnFirstDraw`, and a new kind of drawn object adds its warm-up template (`warmPrograms`).
- Throttled per-N-frame work is phase-offset per instance. Main-thread work goes through a TaskQueue (`addTask(task, { at })`), never a self-budgeted loop.
- Hot caches evict the oldest half, never `clear()`. Caches store their own coordinates.
- Keep the foliage worker's fade-key sort (`instanceCount` truncation depends on it).
- `scene.matrixAutoUpdate = false`: static content is frozen with `freezeStaticSubtree`, including its parent.
- Generation is time-budgeted, nearest-first, and never waits for terrain.
- Player movement (`physics/characterMovement.ts`, shared with server NPCs): slope bands ≤ 25° / 25–45° / slide > 40°, ray-gated support. Never weaken the fall-through defenses (fall clamp, substepping, contact offset, the analytic backstop). → physics/DECISIONS.md
- Buildings are never without a collider (detail < 120u, a sealed convex hull beyond). An NPC frozen inside a far building is DELIBERATE. → building/DECISIONS.md

## UI / Overlay Styling

Every overlay follows the stats overlay's green-on-black terminal look; import it from `src/menus/overlay/styles.ts` (`PANEL_STYLE`, `PANEL_CSS`, `FONT`, `HUD_COLOR`, `HUD_Z_INDEX`) instead of retyping values. The rules (font, colors, containers, inputs, z-indexes, inline styles) are in [src/menus/README.md](src/menus/README.md).

## Conventions

- PascalCase for components/types, camelCase for utilities/functions/properties
- SCREAMING_SNAKE_CASE for constants and enums
- **Comments are for what the code cannot say.** Prefer a descriptive name over a comment — if a name needs a comment to be understood, rename it. A comment earns its place ONLY for: a magic value (units, where the number came from, what constrains it); a non-obvious WHY (a rejected alternative and what broke, a measured result, an invariant another file depends on, a hazard the code guards against); or logic that is genuinely confusing on its own. Never restate the next line, narrate history, or duplicate this file — CLAUDE.md is where long-form rationale lives, and a code comment may point here in one line. Section banners only in files long enough to need navigation. When in doubt, cut it.
- **The horizontal plane is x/z, everywhere** — the world is y-up and `y` is always height, including inside 2D code (voronoi, city grid, density placement, chunk offsets): those use `PointXZ` (`utils/math/types.ts`) and `ix/iz`, `dx/dz`, `sx/sz` names, never `THREE.Vector2` or `.y` for a horizontal coordinate. The ONLY `(x, y)` pair is the abstract 2D noise samplers (`simplex2`/`perlin2`/`terrainNoise` in `utils/workers/noise.ts`), whose inputs are not world axes (the road warp feeds them `(z, 0)`)
- **Hierarchy ownership**: DOMAIN → REGION → BIOME is both the content hierarchy and the folder hierarchy — put code at the level it belongs to (biome-specific in the biome folder, and so on up); only genuinely shared code lives outside `world/domains/`
- **Pattern files per folder**: `types.ts`, `constants.ts`, `defaults.ts`, `utils.ts` at the appropriate level — no grab-bag singleton modules (the old `registry.ts` was split this way)
- **Extend, don't duplicate**: every game object extends its CLASS BASE (`objects/actors/Actor.tsx`, `objects/dressing/Dressing.tsx`, `objects/foliage/Foliage.tsx`) plus the shared attribute types (`objects/types.ts`); actor variants spread a base descriptor
- Feature-based directory structure — co-locate assets (shaders, textures) with their biome/feature
- Prefer editing existing files over creating new ones
- Keep biome implementations self-contained; don't add cross-biome dependencies
- Interfaces live in the nearest `types.ts` (world-level types in `src/world/types.ts`)

## Multiplayer server and entity sync

One Railway service runs `server/` (Node 24, Express + `ws`, `node:sqlite`) and serves the CRA build. Runtime deps are exactly `express` + `ws`. Everything shared with the client (Rapier, delaunator, noise-ts, seedrandom) is BUNDLED from the ROOT install by esbuild, never as a second server-side copy. The server imports `src/`'s Three-free modules; the client never imports `server/`. `game/world.ts` talks to sockets only through an `Outbox`, and that is the only abstraction: do not widen it. Ops runbook: `README.md` → "Server, database, deploy". Layout: [server/README.md](server/README.md) and [src/net/README.md](src/net/README.md).

- Two ids: `identity` (persistent, localStorage) and `id` (the session). Presence is scoped per DOMAIN (rooms). Close the socket on `pagehide`. Never use per-frame React state for networking.
- The SERVER runs every actor's state machine, from the same config file the client has. No client owns anything. Clients place entities by snapshot interpolation on the server clock (`src/net/entities/interpolation.ts`). Configs express motion only through `ctx.motion` and animation through `ctx.animation`, and guard anything scene-bound on `ctx.groupRef.current`. Adding a synced NPC = `stateMachine.ts` + `spec.ts` + a biome `actors` entry. Read [NPC_TRACKING.md](NPC_TRACKING.md) first.
- dotcomma.io runs the last DEPLOYED release: an uncommitted tree is only visible at localhost:3000.

→ [server/DECISIONS.md](server/DECISIONS.md)
