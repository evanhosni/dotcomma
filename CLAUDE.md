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

- `npm run dev` — server + client together (`scripts/dev.mjs`: tsx watch on :8080 + craco on :3000; first run creates + migrates the local SQLite)
- `npm start` — client only (craco); `npm run dev:server` — server only
- `npm run build` — production build
- `npm test` — jest (headless: `$env:CI="true"; npm test -- --watchAll=false`)
- `npx tsc --noEmit` — type check

## Where the docs are

This file is the MAP: architecture, invariants and rules, loaded into every Claude session, so it stays under ~40k characters. Each folder's `README.md` is the reference for its code ("How it works" + "How to use/add"). The RECORD OF DECISIONS (measurements, rejected approaches, the why behind every number) is the `DECISIONS.md` next to the code. **Read the relevant one before changing a system, and put new measurements and rejected approaches THERE, never here**: a line here states the rule and points to it.

| system | decisions doc |
|---|---|
| height pipeline: blending, presence, one source of truth, flatten pads, voronoi caching, biome flags | [src/utils/workers/DECISIONS.md](src/utils/workers/DECISIONS.md) |
| freeway wall network, city terrain | [src/utils/workers/roads/DECISIONS.md](src/utils/workers/roads/DECISIONS.md) |
| rivers, lakes, shores, water, springs, the flow | [src/utils/workers/rivers/DECISIONS.md](src/utils/workers/rivers/DECISIONS.md) |
| inter-city freeways, bridges, deck seams/mouths, lane ends, road fragments, block islands | [src/utils/workers/bridges/DECISIONS.md](src/utils/workers/bridges/DECISIONS.md) |
| domains, navigation, config commit, scope-aware components, addresses | [src/world/domains/DECISIONS.md](src/world/domains/DECISIONS.md) |
| terrain LOD cross-fade | [src/world/terrain/DECISIONS.md](src/world/terrain/DECISIONS.md) |
| game objects, actor spawn lifecycle | [src/objects/DECISIONS.md](src/objects/DECISIONS.md) |
| procedural buildings (interiors, doors, collider LOD) | [src/objects/actors/building/DECISIONS.md](src/objects/actors/building/DECISIONS.md) |
| lighting and VFX (lamp glow, curvature, spawn fade, nightfall hitch) | [src/vfx/DECISIONS.md](src/vfx/DECISIONS.md) |
| player movement (slopes, support, fall-through defenses, surface modifiers) | [src/physics/DECISIONS.md](src/physics/DECISIONS.md) |
| float64/float32 split, rebasing | [COORDINATE_PRECISION.md](COORDINATE_PRECISION.md) |
| every performance measurement, outrunning the generators | [PERFORMANCE.md](PERFORMANCE.md) |
| server, persistence, deploy, entity sync, server physics | [server/DECISIONS.md](server/DECISIONS.md) |
| caves, sewers, snow, rocks (tunnels, terrain holes, player underground) | [src/utils/workers/underground/DECISIONS.md](src/utils/workers/underground/DECISIONS.md) |

Also: [src/world/VERTEX_JOURNEY.md](src/world/VERTEX_JOURNEY.md) (one vertex through the pipeline and the shader), [NPC_TRACKING.md](NPC_TRACKING.md) (the NPC sync guide), `CHANGES.md` / `SERVER_CHANGES.md` (history logs).

## Architecture

### Content hierarchy — DOMAIN → REGION → BIOME, everything is a component

```
<Domain>  // one switchable world (home, overworld); global rulesets + systems
  <Terrain/>  //  global terrain rules (seed, grids, road noise, rivers, city, default blend widths)
  <Material/>  //  river BED texture (under every river channel)
  <Skybox/>  //  default sky
  <PostProcessing/>  //  global post-processing
  <Regions specs components> // the region spec list IN ORDER (= voronoi order; config.ts reads the same list); null = config-only
  <Region spec biomes>  // spec = id/name/baseNoise/blend widths/riverProbability/biome order; `biomes` = components by name
    <Material/>  //  its BASE material — what a biome's own texture fades into at the biome's edge (presence)
    <Skybox/>  //  its sky (mixed by position across region edges)
    <Biome spec>  // rendered by <Region> in spec.biomes order; spec: joinable, noise|water, blend widths, `actors`,
                             //  the FLAGS the world-wide systems read (snow, rocks, riverBankRelief: true | {…overrides}),
                             //  and its FEATURES (a spec.tsx tree — see below), which <Biome> draws
      <Material/>  //  biome fragment shader (<Material shader textures>)
                             //  ACTOR class: per-object spawns (identity/state/interaction) are
                             //  DATA — spec.actors: [{ actor: ActorSpec, …overrides }], registered by <Biome>
      <Dressing>  //  DRESSING class: mass stateless scenery, instanced per chunk; biome-SPECIFIC features only
        <StreetLamps/>  //  group props (renderDistance) are shared defaults; children
        <RoadMarkers/>  //  take their placement knobs as props
      </Dressing>
      <Foliage>  //  FOLIAGE class: mass GPU vegetation (per-instance attributes,
        <GrassField/>  //  shader animation); same group-defaults pattern
      </Foliage>
      <Skybox/>  //  optional per-biome sky override
    </Biome>
  </Region>
  <Dressing>  // FLAG-DRIVEN dressing, mounted ONCE: each draws every biome whose spec sets its flag
    <SnowDrift/> <Rocks/> <RiverSplashes/> <LakeBubbles/>  (a biome mount is a content error)
  </Dressing>
</Domain>

features: (  // a biome spec's FEATURES (spec.tsx): read as DATA by the server and workers, drawn by <Biome>
  <Sewers chance>  //  no <Sewers>, no sewers
    <SewerSideRoom chance>  //  a PART — no child, no side rooms
      <Spawn actor={BEEBLE_SPEC} />  //  one per side room, server-simulated
    </SewerSideRoom>
  </Sewers>
)
```

**The hierarchy is also the FOLDER hierarchy** (`src/world/domains/<domain>/regions/<region>/biomes/<biome>/`): biome-specific code in the biome's folder, region-specific in the region's (`region.tsx`, `spec.ts`, `shaders/base.glsl` = its BASE material), domain-specific in the domain's; only genuinely shared code lives above the domains. A REGION is a group of biomes with its own base noise, base material, sky and `riverProbability`, partitioned by a voronoi grid above the biome grid (`regionGridSize` 3000 → biome `gridSize` 500). No edge, region or biome, is a hard boundary: height, material and sky cross-fade into the neighbor ("Blending"); rivers are the edges of their own grid and cross everything ("Rivers"). The overworld has four: **city** (city + grass on the default base, `riverProbability` 0.35), **desert** (dust + salt on their own simplex base, 0.15), **snow** (tundra + mountain on a slow perlin base, 0.55), **ocean** (lake biomes — bowls under a blended water level — on a near-flat base, 0.6).

**The three game-object classes** (`src/objects/`; the ATTRIBUTE HIERARCHY is one file, `src/objects/types.ts`: `GameObjectAttributes` → `ActorAttributes` / `DressingAttributes` / `FoliageAttributes` → member attributes next to the member; a field lives at the highest level where two users share it): **ACTORS** have their own identity, state or interaction (creatures, buildings), each its own React component through the spawn lifecycle (`ActorPool`); a kind is ONE Three-free `ActorSpec` (`<actor>/spec.ts`), `describeActor(spec)` its descriptor, every attribute forwarded to the instance as props (minus `SPAWN_ONLY_KEYS`), overridable per biome mount (`BiomeSpec.actors`). **DRESSING** is mass stateless identical scenery (lamps, markers, rocks, snow, tunnels, particles) per 256u chunk with zero per-object components. **FOLIAGE** is vegetation at another order of magnitude (~32k instances per 64u chunk, placement streamed straight into GPU instance attributes, animation in the vertex shader). All three are placed off-thread and deterministically (spawn / dressing / foliage workers).

**EVERY game object is built on its class's BASE, and each base owns ALL logic its members share** — structural, not stylistic: a world-wide effect (curvature, quantization, lamp glow, the spawn fade, the shared frame driver, GPU warm-up) is implemented ONCE per base and inherited by belonging to the class. An object that hand-rolls what its base does will silently miss the next one.

| class | base | what the base owns | a member is |
|---|---|---|---|
| ACTOR | `objects/actors/Actor.tsx` | `useActorLifecycle` (ONE shared frame driver, the one 2D distance, spawn fade in/out + despawn, frustum visibility + warm-up, distance-gated colliders with hysteresis and a global throttle, a "near" gate, matrix freezing) and `prepareActorMaterial` (quantization + lamp glow + curvature + spawn fade) | `<ModelActor>` (`actors/ModelActor.tsx`: pooled GLTF clone, colliders, animation LOD), or `useActorLifecycle` directly for an actor owning its geometry (`Building`) |
| DRESSING | `objects/dressing/Dressing.tsx` | `useDressingChunks` (camera-following 256u chunk lifecycle on one budgeted queue), `useDressingAssets` + `prepareDressingMaterial` (creation, curvature, spawn fade per chunk, disposal), `instancedFromPoints` / `finalizeInstancedChunk` (assembly + rebase + culling bounds + warm-up), `useSolidDressing` (a collider feature's chunks, spec placement, bodies, distance-gated imperative colliders), `selfPatchedMaterial` (a feature's own program on the shared chunk projection), `useDomainWideDressing` (a flag-driven feature's mount guard) | a component with ONLY its geometry/materials, its placement (an enumerator + args, or its collider spec) and optional animation (`StreetLamps`, `RoadMarkers`, `TrafficLights`, `PowerLines`, `Bridges`, `Rocks`, `SnowDrift`, `Caves`/`Sewers`, `RiverSplashes`/`LakeBubbles`) |
| FOLIAGE | `objects/foliage/Foliage.tsx` | the ENTIRE pipeline: chunk lifecycle, worker streaming, the instanced billboard mesh, the shader (billboarding, sway, distance fade, quantization, curvature, spawn fade, night dim), the distance LOD, disposal | `createFoliage({…})` with a plant's art + defaults, every knob overridable at the mount (`grass/GrassField.tsx` is ~60 lines) |

Rule of thumb: unique geometry, interaction or behavior → actor; many + identical + stateless → dressing; thousands-per-chunk vegetation → foliage. The PARTICLE base (`src/particles/`: GPU-looped instanced quads, one clock uniform) is drawn by dressing members (`createParticleDressing`).

### Systems: the invariants (details and history in the decisions docs)

- **Domains share ONE page and ONE canvas.** No router: URL paths are fake (`pushState` only, `src/world/domains/navigation.ts`). `OverworldDomain` is THE game, one infinite map; every path except `/` is an ADDRESS inside it; `HomeDomain` (`/`) is the landing page. A domain switch happens inside ONE persistent `<CustomCanvas>` in two phases (render no domain, `resetDomainSystems()`, mount the new one); the canvas, GL, programs, `<Physics>`, Player, contexts and overlays are never torn down. Per-domain scene state is a `<Domain>` prop (`background`, `playerSpawn`). Travel within the overworld is a TELEPORT (`ADDRESS_TRAVEL_EVENT` → `FastTravel.tsx`); the browser BACK button fires the escape pod (`ESCAPE_POD_EVENT`) and can never unload the game. Home keeps its `<Terrain>` (`terrain={false}` still commits the flat config; home/README.md). → domains/DECISIONS.md
- **Config commit.** Config components (`src/world/components/`, plus `Skybox`) register during layout effects; `<Domain>` commits a plain `Region[]` + serializable `DomainConfig` to the active-domain accessors (`src/world/domains/utils.ts`: `getActiveRegions()`, `getActiveDomainConfig()`, `getTerrainParams()`, `await whenDomainReady()`) and mounts `TerrainRenderer`, `ActorPool`, `SkyboxSystem`. `<Region spec>`/`<Biome spec>` register the whole spec; `<Regions>`/`<Region biomes>` render their component maps IN SPEC ORDER (dev-throw on a mismatch). `overworld/config.ts` builds the SAME config for the server (dev console.errors when they differ); `ACTOR_CATALOG` derives from `DOMAIN_REGIONS`; `assembleDomainConfig` asserts unique ids and names. `Material`/`Skybox` are scope-aware:
  - under `<Domain>`: the river-bed texture / the default sky
  - under `<Region>`: the BASE material / a sky mixed by region weights
  - under `<Biome>`: the biome frag / a sky override

  `Terrain` is domain-only.
- **Biome flags: never a biome id or name.** Every biome difference a system keys on is a spec FLAG (`water`, `snow`, `rocks`, `riverBankRelief`, each `true | {…overrides}` resolved against ONE defaults file per system into the config) or the biome's SHAPE (`isRockBiome`: a domed biome is rock), read through ONE helper, `utils/workers/biomeFlags.ts` (`…BiomeIds()`, `…ParamsOf(id)`, `isWaterRegion`). The bespoke city height branch is the one id the pipeline names, and `roadBearingBiomeIds()` is where it becomes a flag for everything downstream. → workers/DECISIONS.md
- **Addresses: the URL is a place.** `/<region words>/<biome words>` is a BIJECTIVE encoding of cell coordinates (never a hash or a registry). FROZEN: the word lists (append-only), the scramble constant, the seed, the region/biome order, the grid sizes; `address.test.ts` pins the vectors. Debug: `window.__dotcomma.travelTo(x, z)` (`travelTo(x, z, y)` lands at `y` with the terrain gate open: into a tunnel). → domains/DECISIONS.md
- **Blending: no boundary anywhere, ever.** Every zone wall cross-fades: heights on the CPU, the material per PIXEL, the sky by position.
  - The shader gets per-biome-slot SIGNED DISTANCES (`biomeSdf`), never a weight or a biome id; indicators combine by CRISPNESS PRECEDENCE (`combineZoneWeights`), never plain normalization; a biome fades into its region's BASE by `presence`; the material feather uses the SMALLER side's width; only LOD3–4 clamp the blend fields; widths resolve biome → region → domain default.
  - `biomeSdf`/`biomePresence` are returned in their OWN buffers (the pad recursion clobbers the scratch); every vertex attribute is FINITE (`RIVER_BED_FAR`, `BIOME_SDF_FAR`): one Infinity vertex makes the whole triangle NaN.

  → workers/DECISIONS.md
- **Heights have a single source of truth:** `src/utils/workers/vertexCompute.ts` (`computeVertexData`, steps 0–14 in one order: VERTEX_JOURNEY.md). Every worker, the main thread (`world/terrain/vertexData.ts`) and the server run it. Biome heights come from the spec's `noise` (+ `detail` layers); bespoke biomes (city) have a branch in the pipeline. Never add a second height code path, and never read a height on a stepping thread (the ground's modifiers are sampled on a worker).
- **Flatten-ground pads** (`flattenGround: true`): placement is FULLY DETERMINISTIC (`utils/workers/flattenPads.ts`), and both `applyFlattenPads` and spawn.worker consume it. Raw height is NOT a lower bound, because pads excavate, so any below-surface test must confirm with the padded height (`resolveEmbeddedSurface`). Far visual-only LODs skip pads. → workers/DECISIONS.md
- **Freeways live on the biome walls** (`getNetwork`, per cell, over a wide window, lazy via `networkOf(ctx)`). The city's BELT freeway is centered ON its wall, and runs start at the belt's wall junctions. → roads/DECISIONS.md, bridges/DECISIONS.md
- **Rivers are the edges of their OWN voronoi grid** (`rivers/riverNetwork.ts`), a pure function of position, so every chunk, worker and the server agree.
  - Nothing is cut for a city: the city ADAPTS (quays, waterfront belt). Where they conflict, the road wins: suppressed stretches end bluntly (the road layer keys on `roadBearingBiomeIds()`).
  - `riverFieldAt` runs FIRST in `computeVertexData`: building a river list evaluates terrain and clobbers the scratch.
  - ROCK (`isRockBiome`) is built whatever its slope (waterfalls); a peak along the river is a level POOL (`riverPoolWiden`); half the rivers entering rock end in a SPRING CAVE (`underground/springs.ts`), whose water is the terrain's own sheet (step 14). `waterFlowX/Z` carries the downhill flow to the water shader. The bed paint ends at the first steep ROCK bank and never resumes (`capRiverBed`).
  - Physics does not know water.

  → rivers/DECISIONS.md
- **Lakes** are a biome with `water: { depth }`. The level is blended by a kernel. Land near water never sits below it (`shoreLift`). The water is a child mesh per terrain chunk, at render order `WATER_RENDER_ORDER` (10), writing no depth. → rivers/DECISIONS.md
- **Bridges are DRESSING, computed geometrically.** A deck exists only where a road genuinely crosses a river, landed on dry road at both ends, continuous with it; deterministic per window; colliders are a trimesh of exactly the drawn ribbon; the terrain is cut under the DRAWN slab; a vertex fetches its cell's decks FIRST (enumerating them evaluates terrain). Keep `DRESSING_CHUNK_SIZE` consistent between client and server. → bridges/DECISIONS.md
- **Tunnels (caves, sewers) are spec FEATURES, dressing and an OVERLAY**: their one height step is the cave MOUTH BULGE (`mouthBulge.ts`, step 10, from caves generated on the un-bulged ground). A cave ENTRANCE is ONE isosurface of ground and tunnel, drawn with the terrain's material fading into rock (`entrance.ts`, `tunnelRock.ts`); the terrain is cut per pixel there and at shafts (`terrainHoles.ts`). The player and every server NPC move by ONE rule set (`physics/tunnelRules.ts`) on a `TunnelSpace` each: heightfields are ignored in a tunnel's air and in a mouth's CUT, where the drawn entrance patch is the collider. Manholes and doors are the SERVER's state. Snow is ONE rule for the near sheet, the terrain's whitening and the wading; rocks a density field per biome plus every mouth's spots, plus the bare boulders of every waterfall and the odd rock in calm water (`rivers/waterfallRocks.ts`, ONE list the `rocks` enumerator draws and the splash enumerator bursts on). → underground/DECISIONS.md, rivers/DECISIONS.md
- **City terrain** (`roads/cityTerrain.ts`):
  - Rotated staggered DISTRICTS, each holding a square block grid (not voronoi), with arterials on the district boundaries.
  - ONE normalized road field drives the shader bands, the curb dip and the spawn filters, and is the global "is a road here" test (mouth fitness, the sewers' on-street nodes). `cityConfig.roadWidth` (7, the half-width) must match the city shader's bands.
  - A fully pairwise LINEAR chamfer.
  - The phase varyings (`vFreewayAlong`, `vDistanceToFreewayCenter`) jump at seams: never paint from them without the `fwidth()` guard.

  → roads/DECISIONS.md
- **Coordinate precision:** generation is float64 on ABSOLUTE coordinates and is never rebased (every seed would change). Rendering is float32 and must never form an absolute world coordinate: build positions as rebase origin + offset, projected through `modelViewMatrix[3]` — every chunk-relative custom program does it through ONE GLSL function, `projectChunkLocal` (`world/shaders/chunkProjection.ts`: the terrain, water, tunnels, snow, rocks, particles). Any world-space period read from `vWorldPosWrapped` must divide `WORLD_WRAP` (4200). `vWorldPosAbs` is for lighting and the terrain holes only. Every instanced dressing chunk goes through `finalizeInstancedChunk`. → COORDINATE_PRECISION.md
- **Workers** are initialized from the first committed config. A domain switch re-inits them by termination.

### Directory Layout

Each README is the reference for its folder's files; this tree is the map.

```
src/
  index.tsx  boot: navigation + connection + ONE persistent <CustomCanvas>; mounts DOMAIN_COMPONENTS[domain]
  objects/  THE GAME-OBJECT HIERARCHY  objects/README.md
    types.ts  GameObjectAttributes → Actor/Dressing/FoliageAttributes
    utils.tsx  createDefaultsGroup (<Dressing>/<Foliage> group defaults), definedOnly
    geometry.ts  bakeVertexColor, mergeOrThrow (vertex-colored parts, shared by buildings, doors, tunnels)
    actors/  ACTOR class: Actor.tsx = THE BASE (useActorLifecycle, prepareActorMaterial)  actors/README.md
      ModelActor.tsx  the standard GLTF member (+ the behavior wiring for any spec with a stateMachine)
      spec.ts  ActorSpec / ActorMount (Three-free); catalog.ts = actorCatalogOf; components.ts = ACTOR_COMPONENTS
      modelClonePool.ts, animationPlayer.ts, kinematicMover.tsx
      spawning/  ActorPool, spawnWorker (client), collectDescriptors, types  spawning/README.md
      state/  the Three-free state machine core + motion/animation/input channels  state/README.md
      colliders/  GLTF colliders + collider.worker  colliders/README.md
      beeble/  the template NPC: spec.ts + stateMachine.ts (+ inflate.ts, its ascend morph)
      building/  procedural buildings: generatePlan → buildingAssets (cache, phased builds) → Building  building/README.md
    dressing/  DRESSING class: Dressing.tsx = THE BASE (chunks, assets, instancing, selfPatchedMaterial,
                         useDomainWideDressing); dressingColliders.tsx = useSolidDressing + the collider bodies  dressing/README.md
      enumerators.ts  DRESSING_ENUMERATORS (name → placement); catalog.ts = DRESSING_COLLIDER_SPECS; types.ts (Three-free)
      street-lamps/ road-markers/ traffic-lights/ power-lines/ bridges/ rocks/ snow-drift/ underground/  one folder + README each
      particles/  the particle DRESSING members (RiverSplashes, LakeBubbles) on the base in src/particles/
    doors/  THE hinged door (leaf geometry, swing, hover), shared by buildings and the sewers  doors/README.md
    sprite-lod/  far billboards (one instanced mesh per look), handed off by spawn-point id  sprite-lod/README.md
    foliage/  FOLIAGE class: Foliage.tsx (pipeline + createFoliage), foliageLod.ts (bands,
                         taper), foliageMaterial.ts (the shader)  foliage/README.md
      grass/ seaweed/  the plants
  world/
    CustomCanvas.tsx  THE canvas (GL context, <Physics>, Player, contexts — never torn down)
    types.ts, defaults.ts, constants.ts (CITY_BIOME_ID only)
    VERTEX_JOURNEY.md  one vertex from chunk request to pixel, every step in order
    components/  the declarative API: Domain, Regions/Region, Biome, Terrain, Material, Actor  components/README.md
    domains/  DOMAIN → REGION → BIOME content  domains/README.md
      navigation.ts, reset.ts, utils.ts (active-domain accessors), domainConfig.ts + buildDomainConfig.ts
      configs.ts  DOMAIN_REGIONS, DOMAIN_CONFIGS (the server's copy), ACTOR_CATALOG
      components.ts  DOMAIN_COMPONENTS
      overworld/  THE game: domain.tsx (+ the flag-driven dressing mounts), config.ts, address.ts, FastTravel.tsx  overworld/README.md
        regions/  index.ts = OVERWORLD_REGIONS; city/ desert/ snow/ ocean/ — region.tsx + spec.ts +
                         shaders/base.glsl + biomes/<b>/{biome.tsx, spec.ts, shaders/fragment.glsl}  regions/README.md
      home/  the landing page: HomeGround, CrtMonitor + crtScreen, ClickToEnter  home/README.md
    terrain/  TerrainRenderer (chunk lifecycle, lod1ShareAt), buildRequests, chunkObjects (plane, water, colliders),
                         chunkGeometry, terrainWorker (pool of ≤2), lodConfig, lodQuadtree (+ LOD1 sites), lodSwaps + chunkIndex,
                         material.ts (+ variants), vertexData.ts  terrain/README.md
    shaders/  vertex.glsl, common.glsl (bedShade), combineBiomeMaterials.ts, lodFade.ts, farFade.ts, terrainHoles.ts,
                         tunnelRock.ts, chunkProjection.ts (every custom program's vertex stage), constants.ts  shaders/README.md
    water/  waterMaterial.ts (swells, advected noise, falls, the flow)  water/README.md
    sky/  Skybox (+ SkyboxSystem), DayNightCycle + celestialBodies  sky/README.md
  lighting/  dayNight.ts channels, DayNightLights, lampGlow (the glow grid), personalLight (the player's own light in the dark)  lighting/README.md
  particles/  THE particle base: particleMaterial.ts (GPU-looped instanced quads, one clock uniform), particleChunk.ts  particles/README.md
  physics/  characterMovement.ts — THE capsule resolver (player + server NPCs); movementModifiers.ts (the ground's drag/traction)  physics/README.md
  player/  Player.tsx, undergroundMode.ts (tunnels, manholes), groundSafetyNets.ts (backstop, stuck
                         escape), waterProbe.ts, useInput.tsx, spec.ts, constants.ts (CAMERA_FAR)  player/README.md
  net/  protocol.ts (THE wire copy), connection, playerData, players/, entities/  net/README.md
  context/  GameContext, DevContext, constants.ts (DEV_TOGGLES)  context/README.md
  menus/overlay/  StatsOverlay, DevOverlay, LogsOverlay, NetOverlay, styles.ts  menus/README.md
  save/  save.ts: ONE JSON save in two stores, device (localStorage) and account (the hosted blob)  save/README.md
  vfx/  PostProcessing, curvature, quantization, spawnFade, dither, frameCap,
                         materialPatch (chainMaterialPatch, shared by every patcher)  vfx/README.md
  utils/  _math (seedRand), seededStream, TaskQueue, warmPrograms, uploadOnFirstDraw, contentError, spikeTrace,
                         _material (textures, fromShader), cursor  utils/README.md
    workers/  THE HEIGHT PIPELINE (vertexCompute.ts + modules, rivers/ roads/ bridges/ underground/
                         snow/ rocks/, biomeFlags.ts) + the terrain/spawn/foliage/dressing/underground workers
                         + workerClient  workers/README.md
server/  the game server (bundled; imports src/'s Three-free modules)  server/README.md
NPC_TRACKING.md  how NPCs sync, and how to write one
CHANGES.md, SERVER_CHANGES.md  history logs
```

### Terrain Pipeline

1. Player position → `computeDesiredChunks()` (quadtree LOD; the cave mouths' LOD1 sites) → `buildChunk()` async generator
2. Per-vertex: `computeVertexData` (or its raw/far variants) — every step, what it overrides and the shader's mix order: [`src/world/VERTEX_JOURNEY.md`](src/world/VERTEX_JOURNEY.md)
3. Geometry buffers written, normals computed, skirts set; the water child mesh with its depth and flow
4. LOD swaps CROSS-FADE (`lodSwaps.ts`): old and new chunks draw together with complementary screen-door dither; every chunk that needs a `discard` (mid-fade, reaching the far fade in the last 72% of `camera.far`, touching a tunnel opening, or any while the player is in a tunnel) draws the ONE discard variant, the rest the base program (early depth); every terrain program is ~0.6s of main-thread link in Firefox, so add a variant only when no existing one can carry it. Colliders keep their own lifecycle. → terrain/DECISIONS.md

### Actor Spawn Lifecycle

`spawn.worker.ts` gives deterministic, cached spawn points; `ActorPool.tsx` mounts and unmounts them with radius hysteresis (immediate / spawn / despawn). Only REspawns are blocked inside the immediate radius (a 1s despawn ledger); nothing is permanently despawned, ids are position-based. → objects/DECISIONS.md

### Key Patterns

- **Registration effects use stringified deps** — inline object props register under `JSON.stringify` deps, so parent re-renders don't re-commit the domain.
- **Utility namespaces** (material patchers + texture loading only): `_material.loadTextures()`, `_quantization`, `_curvature`. Math helpers are plain exports (`seedRand`, `smoothstep` from `utils/math/_math.ts`; `seededStream` for many draws from one seed)
- **Worker clients extend `createWorkerClient`** (`utils/workers/workerClient.ts`) — never hand-roll a pending map / INIT handshake / terminate; a client file is only its typed request wrappers.
- **Density placement has ONE implementation** (`utils/workers/densityGrid.ts`), shared by the spawn worker, the flatten-pad engine and the dressing worker (that is what keeps pads under buildings); `passesPlacementFilters` rejects every point within `riverKeepOff()` of a river for EVERY object.
- **Content mistakes are loud**: every check of a spec, mount, shader or machine reports through `reportContentError` (`src/utils/contentError.ts`: throws outside production, logs in it). Use it for any new check.
- **Biome shaders**: each biome/region fragment shader becomes a named function; `combineBiomeMaterials` mixes them per pixel from the `vBiomeSdf0/1` / `vBiomePresence0/1` varyings (no biome id in the shader); the vertex shader is shared
- **Geometry pooling**: `acquireGeometry()`/`releaseGeometry()` recycle BufferGeometry per LOD level
- **Voronoi caching**: grids, triangulations, wall lists and sites are memoized (on grid identity / per cell); never rebuild the wall arrays per vertex. → workers/DECISIONS.md
- **DomainConfig** (`world/domains/buildDomainConfig.ts`): the serializable config sent to workers — regions and biomes (base noise, riverProbability, water, the resolved snow/rocks params and the caves/sewers params of the specs' `features`, blend widths), the `<Terrain>` params, biome noise, flatten descriptors (from the specs' `actors`), city config

## Adding Content

Each flow's checklist lives in the README of the folder it touches; this table says where, and what it costs. Mistakes are LOUD in dev (`reportContentError`): mismatched spec lists, duplicate ids/names, shader clashes, bad state machines, unplaced server actors, unwarmed programs, a flag-driven feature mounted in a biome.

| to add | files | checklist |
|---|---|---|
| a biome | 3 new (`spec.ts`, `shaders/fragment.glsl`, `biome.tsx`) + 2 one-line edits (the region's spec list and component map) | [regions/README.md](src/world/domains/overworld/regions/README.md) |
| a region | 3 new + its biomes + 2 one-line edits (`OVERWORLD_REGIONS`, the domain's component map) | same |
| a lake-type biome | a biome with `water: { depth }` | [water/README.md](src/world/water/README.md) |
| a bespoke-height biome (like the city) | a biome without `noise` + a branch in the pipeline | [workers/README.md](src/utils/workers/README.md) |
| a static prop | 1 new (`spec.ts`) + 1 line in a biome spec's `actors` (+ the GLB) | [actors/README.md](src/objects/actors/README.md) |
| an NPC | 2 new (`stateMachine.ts`, `spec.ts`) + 1 line in a biome's `actors` — placing it IS cataloging it; nothing on the server | same, and [NPC_TRACKING.md](NPC_TRACKING.md) §6 |
| an NPC with scene logic | + 1 component registered in `ACTOR_COMPONENTS` / `ActorComponentName`, named by `component` on the spec; `withModelActorWarmup` | [actors/README.md](src/objects/actors/README.md) |
| a building variant | 2 edits: a spec in `building/spec.ts` + a biome mount (flatten pads and the server's hull follow) | [building/README.md](src/objects/actors/building/README.md) |
| a far sprite | `spriteLod` on the spec + a describer + a `SpriteLook` | [sprite-lod/README.md](src/objects/sprite-lod/README.md) |
| tunnels under a biome | `<Caves>` / `<Sewers>` in its spec's `features` (spec.tsx), parts (`<CaveSideRoom>`, `<SewerSideRoom>`) and `<Spawn>`s inside; nothing else | [underground/README.md](src/objects/dressing/underground/README.md) |
| snow / rocks on a biome | `snow: true \| SnowParams` / `rocks: true \| RockParams` on its spec — nothing to mount | [snow-drift/README.md](src/objects/dressing/snow-drift/README.md), [rocks/README.md](src/objects/dressing/rocks/README.md) |
| a per-biome parameter of a flagged system | 1 field on its params type + its default in that system's defaults file | [workers/README.md](src/utils/workers/README.md) |
| a particle effect | a `ParticleLook` + a Three-free emitter enumerator (+ 1 `DRESSING_ENUMERATORS` line, a test) + 1 `createParticleDressing` member + 1 mount | [particles/README.md](src/particles/README.md) |
| a plant | 1 new (`<Name>Field.tsx` = `createFoliage`) + 1 mount; its own `seed` | [foliage/README.md](src/objects/foliage/README.md) |
| a dressing feature | 1 new component + 1 mount (density-placed); + an enumerator function, its re-export, one `DRESSING_ENUMERATORS` entry and a test (structured); flag-driven → mounted under `<Domain>` | [dressing/README.md](src/objects/dressing/README.md) |
| …solid (client + server colliders) | + a Three-free `*Spec.ts` + 1 `DRESSING_COLLIDER_SPECS` line; the component calls `useSolidDressing` | same |
| a skybox | 1 `<Skybox>` line in a region or biome | [sky/README.md](src/world/sky/README.md) |
| a glow source / glow color | `registerLampHeads(...)` + its disposer / 1 `LAMP_COLORS` entry | [lighting/README.md](src/lighting/README.md) |
| an overlay | 1 new file (styles from `menus/overlay/styles.ts`) + 1 mount | [menus/README.md](src/menus/README.md) |
| a dev toggle | 1 `DEV_TOGGLES` entry | [context/README.md](src/context/README.md) |
| a saved field | 1 `SaveData` field + `saveToDevice`/`saveToAccount` | [save/README.md](src/save/README.md) |
| a CRT page | 1 `EXTRA_PAGES` line (a region's page is automatic) | [home/README.md](src/world/domains/home/README.md) |
| a world-wide VFX | a patcher in `vfx/` + a `<PostProcessing>` prop + the six class-base call sites | [vfx/README.md](src/vfx/README.md) |
| a network message | `protocol.ts` + server validation/handler + a client sender/listener | [net/README.md](src/net/README.md) |
| a domain (a separate page; today only `home`) | `domain.tsx` + its regions + `DOMAIN_IDS`, `DOMAIN_COMPONENTS`, `DOMAIN_REGIONS` entries + its path in `navigation.ts` | [domains/README.md](src/world/domains/README.md) |

Rules no checklist can enforce:
- **Adding a region or a biome MOVES THE MAP.** The region roll is `floor(u × count)` over `OVERWORLD_REGIONS` and the biome roll over each region's `biomes`: appending one re-rolls every cell of that grid and every address. Do it before anyone has linked to an address, or accept it knowingly.
- **Pick the object class first** (see "The three game-object classes"): lamps built as actors cost 10–20 fps.
- **A shared behavior goes in the class base**, never into one member; a new world-wide effect is applied from the bases only.
- **A biome shared by two regions** is its folder duplicated under the second region with a new component name, the SAME `id` and a RE-EXPORT of the spec (registrations merge by id); its visual children render once per copy, and the shader fades it into the base of only the FIRST region listing it (`biomeSlotRegionsOf`).
- **Blend widths have no upper limit.** Past ~250u (half a cell) a lone cell never reaches full presence at its centre — a softer, partly-blended biome, a valid look (grass and dust inherit the 300 default).

### Hard rules from measurements (numbers in PERFORMANCE.md and the decisions docs)

- Physics steps once per frame (`timeStep="vary"`). Never go back to a fixed step without driving kinematic bodies from it.
- Never mount per-chunk/per-object `<RigidBody>`s: terrain heightfields, dressing colliders, NPC capsules, building proxies and tunnel colliders are IMPERATIVE Rapier bodies.
- Never add a `useFrame` to an actor: pass `onFrame` to `useActorLifecycle` (one shared driver). Never attach R3F pointer handlers to spawned actors.
- New mass content that can mount off-screen uses `uploadOnFirstDraw`; a new kind of drawn object adds its warm-up template (`warmPrograms`).
- Throttled per-N-frame work is phase-offset per instance; main-thread work goes through a TaskQueue (`addTask(task, { at })`), never a self-budgeted loop.
- Hot caches evict the oldest half, never `clear()`. Caches store their own coordinates.
- Keep the foliage worker's fade-key sort (`instanceCount` truncation depends on it).
- `scene.matrixAutoUpdate = false`: static content is frozen with `freezeStaticSubtree`, including its parent.
- Generation is time-budgeted, nearest-first, and never waits for terrain.
- Player movement (`physics/characterMovement.ts`, shared with server NPCs): slope bands ≤ 25° / 25–45° / slide > 40°, ray-gated support, the ground's `MovementModifiers` (`physics/movementModifiers.ts`: the snow's drag and traction, sampled OFF the stepping thread and handed in as `input.surface`, so server NPCs wade too; slope limits shift at most ±15°), terrain ignored only through `ignoreTerrain`. Never weaken the fall-through defenses (fall clamp, substepping, contact offset, the analytic backstop). → physics/DECISIONS.md
- LOD tiers are each a `renderDistance` under one spawn/despawn rule (`spawning/radii.ts`); past its own, an actor spawn-fades into its sprite (COMPLEMENTARY pixels). → building/DECISIONS.md
- Buildings are never without a collider (detail < 120u, a sealed convex hull beyond); an NPC frozen inside a far building is DELIBERATE. → building/DECISIONS.md
- Models are plain GLB with separate vertex buffers; `useGLTF` runs with Draco OFF, and a Draco model is a loud content error. → objects/DECISIONS.md

## UI / Overlay Styling

Every overlay follows the stats overlay's green-on-black terminal look from `src/menus/overlay/styles.ts` (`PANEL_STYLE`, `PANEL_CSS`, `FONT`, `HUD_COLOR`, `HUD_Z_INDEX`), never retyped ([src/menus/README.md](src/menus/README.md)).

## Conventions

- PascalCase for components/types, camelCase for utilities/functions/properties
- SCREAMING_SNAKE_CASE for constants and enums
- **Comments are for what the code cannot say.** Prefer a descriptive name. A comment earns its place ONLY for a magic value (units, provenance), a non-obvious WHY (a rejected alternative, a measurement, an invariant another file depends on, a hazard) or genuinely confusing logic. Never restate the next line, narrate history or duplicate this file. When in doubt, cut it.
- **The horizontal plane is x/z, everywhere** — `y` is always height, inside 2D code too (voronoi, city grid, density placement, chunk offsets): `PointXZ` / `RectXZ` (`utils/math/types.ts`) and `ix/iz`, `dx/dz`, `sx/sz` names, never `THREE.Vector2` or `.y` for a horizontal coordinate. The ONLY `(x, y)` pair is the abstract 2D noise samplers (`simplex2`/`perlin2`/`terrainNoise` in `utils/workers/noise.ts`), whose inputs are not world axes
- **Hierarchy ownership**: DOMAIN → REGION → BIOME is both the content and the folder hierarchy — code lives at the level it belongs to; only genuinely shared code lives outside `world/domains/`
- **Pattern files per folder**: `types.ts`, `constants.ts`, `defaults.ts`, `utils.ts` at the appropriate level — no grab-bag singleton modules (the old `registry.ts` was split this way)
- **Presence by mounting (wherever possible)**: a feature exists BECAUSE its component is mounted under its owner, an optional part is a CHILD, its knobs are props (no `<Sewers>`, no sewers; no `<SewerSideRoom>`, no side rooms; a side room's spawns mounted inside it). Never a flag restating a mount. DOMAIN → REGION → BIOME → FEATURE → PART. What the server or a worker must know is a FEATURE in the spec's `features` (world/components/README.md); visual-only children stay in `biome.tsx`.
- **Extend, don't duplicate**: every game object extends its CLASS BASE (`objects/actors/Actor.tsx`, `objects/dressing/Dressing.tsx`, `objects/foliage/Foliage.tsx`) plus the shared attribute types (`objects/types.ts`); actor variants spread a base descriptor
- Feature-based directory structure — co-locate assets (shaders, textures) with their biome/feature
- Prefer editing existing files over creating new ones
- Keep biome implementations self-contained; don't add cross-biome dependencies
- Interfaces live in the nearest `types.ts` (world-level types in `src/world/types.ts`)

## Multiplayer server and entity sync

One Railway service runs `server/` (Node 24, Express + `ws`, `node:sqlite`) and serves the CRA build. Runtime deps are exactly `express` + `ws`; everything shared with the client (Rapier, delaunator, noise-ts, seedrandom) is BUNDLED from the ROOT install by esbuild, never a second copy. The server imports `src/`'s Three-free modules; the client never imports `server/`. `game/world.ts` talks to sockets only through an `Outbox` — the only abstraction; do not widen it. Ops runbook: `README.md` → "Server, database, deploy". Layout: [server/README.md](server/README.md), [src/net/README.md](src/net/README.md).

- Two ids: `identity` (persistent, localStorage) and `id` (the session). Presence is scoped per DOMAIN (rooms). Close the socket on `pagehide`. Never use per-frame React state for networking.
- The SERVER runs every actor's state machine from the same config the client has; no client owns anything; clients place entities by snapshot interpolation on the server clock (`src/net/entities/interpolation.ts`). Configs express motion only through `ctx.motion` and animation through `ctx.animation`, and guard anything scene-bound on `ctx.groupRef.current`. A synced NPC = `stateMachine.ts` + `spec.ts` + a biome `actors` entry; read [NPC_TRACKING.md](NPC_TRACKING.md) first.
- dotcomma.io runs the last DEPLOYED release: an uncommitted tree is only visible at localhost:3000.

→ [server/DECISIONS.md](server/DECISIONS.md)
