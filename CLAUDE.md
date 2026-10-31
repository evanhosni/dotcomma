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
  <PostProcessing/> <DayNightCycle/> <FastTravel/> <RiverSplashes/>
  <CityRegion/> <DesertRegion/> <SnowRegion/> <OceanRegion/>   // VORONOI ORDER (floor(u × count))

<Region id name>               // a group of biomes on one base terrain, under one base look and sky
  <Material shader textures/>  //   its BASE material — what a biome's own texture fades into at its edge
  <Noise params/>              //   its base relief
  <Skybox/>                    //   its sky, MIXED by position across region edges
  <Rivers chance={0.35}/>      //   rivers under it; no <Rivers/> = none (they run on their own grid)
  <CityBiome/> <GrassBiome/>   // VORONOI ORDER

<Biome id name joinable blendWidth>   // everything true of one voronoi zone, as its children
  <Material shader textures riverbed/>        // its fragment shader
  <Noise params offset><Dome/><Detail/></Noise>   // its relief (none = bespoke height code: the city)
  <Water depth={26}/>                          // a lake: bowl + filled surface (and no road along its walls)
  <Sewers><Rooms><Actor actor={BEEBLE_SPEC}/></Rooms></Sewers>   // a feature, its part, what it places
  <Caves><Rooms>…</Rooms></Caves>
  <Snow/> <Rocks density={110}/> <RiverBanks/>  // what lies on it
  <StreetLamps/> <RoadMarkers/> <TrafficLights/> <PowerLines/> <Bridges/>   // its dressing
  <GrassField .../> <SeaweedField/>            // its foliage
  <LakeBubbles/>                               // its particles
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
- `<Domain>` walks its own children once, publishes the `DomainConfig`, the look model, the skies
  and the actor descriptors (`world/domains/utils.ts`), then mounts exactly the `Driver`s the tree
  asked for. `world/content/config.ts` is the ONE config assembler, client and server alike.
- **The SERVER imports the same tree** (`world/domains/index.ts` → `DOMAIN_NODES`,
  `DOMAIN_CONFIGS`, `ACTOR_CATALOG`). Its build replaces three.js and R3F with a stub that answers
  anything (`server/build.mjs`), because nothing a view draws is ever CALLED there. **Every prop the
  config is built from must stay a literal** — a value computed from a three.js object would become
  a stub proxy in the server's config.
- A biome's features reach the pipeline as `SerializedBiome.features` (kind → resolved params).
  `utils/workers/biomeFlags.ts` is generic over it; each system exports its own accessors beside its
  component (`snowBiomeIds()` lives with `<Snow/>`), so deleting a system deletes every mention.

**The hierarchy is also the FOLDER hierarchy** (`src/world/domains/<domain>/regions/<region>/biomes/<biome>/index.tsx`): biome-specific code in the biome's folder, region-specific in the region's (`index.tsx`, `shaders/base.glsl` = its BASE material), domain-specific in the domain's; only genuinely shared code lives above the domains. A REGION is partitioned by a voronoi grid above the biome grid (`regionGridSize` 3000 → biome `gridSize` 500). No edge, region or biome, is a hard boundary: height, material and sky cross-fade into the neighbor ("Blending"); rivers are the edges of their own grid and cross everything ("Rivers"). The overworld has four: **city** (city + grass on the default base, rivers 0.35), **desert** (dust + salt on their own simplex base, 0.15), **snow** (tundra + mountain on a slow perlin base, 0.55), **ocean** (lake biomes — bowls under a blended water level — on a near-flat base, 0.6).

**The three game-object classes** (`src/objects/`; the ATTRIBUTE HIERARCHY is one file, `src/objects/types.ts`: `GameObjectAttributes` → `ActorAttributes` / `DressingAttributes` / `FoliageAttributes` → member attributes next to the member; a field lives at the highest level where two users share it): **ACTORS** have their own identity, state or interaction (creatures, buildings), each its own React component through the spawn lifecycle (`ActorPool`); a kind is ONE Three-free `ActorSpec` (`<actor>/spec.ts`), mounted as `<Actor actor={SPEC} …overrides/>` — in a biome the density field places it, inside a feature that feature does. **DRESSING** is mass stateless identical scenery (lamps, markers, rocks, snow, tunnels, particles) per 256u chunk with zero per-object components. **FOLIAGE** is vegetation at another order of magnitude (~32k instances per 64u chunk, placement streamed straight into GPU instance attributes, animation in the vertex shader). All three are placed off-thread and deterministically (spawn / dressing / foliage workers).

**ONE DRIVER PER KIND.** A dressing or particle feature mounted in a biome renders NOTHING: it
registers, and the single `Driver` `<Domain>` mounts draws every mount of that kind, because chunks
are world-space and a driver per mount would build each one twice. The driver reads its mounts with
`featureMounts(kind)` and takes the `farthest` view distance among them
(`objects/dressing/utils.ts`). The tunnels are the exception — their chunks are built per biome
cell and never overlap, so `<Caves/>`/`<Sewers/>` run one chunk lifecycle per biome.

**EVERY game object is built on its class's BASE, and each base owns ALL logic its members share** — structural, not stylistic: a world-wide effect (curvature, quantization, lamp glow, the spawn fade, the shared frame driver, GPU warm-up) is implemented ONCE per base and inherited by belonging to the class. An object that hand-rolls what its base does will silently miss the next one.

| class | base | what the base owns | a member is |
|---|---|---|---|
| ACTOR | `objects/actors/index.tsx` | `useActorLifecycle` (ONE shared frame driver, the one 2D distance, spawn fade in/out + despawn, frustum visibility + warm-up, distance-gated colliders with hysteresis and a global throttle, a "near" gate, matrix freezing) and `prepareActorMaterial` (quantization + lamp glow + curvature + spawn fade) | `<ModelActor>` (`actors/ModelActor.tsx`: pooled GLTF clone, colliders, animation LOD), or `useActorLifecycle` directly for an actor owning its geometry (`building/index.tsx`) |
| DRESSING | `objects/dressing/index.tsx` | `useWorldChunks` (camera-following 256u chunk lifecycle on one budgeted queue), `useChunkAssets` + `prepareChunkMaterial` (creation, curvature, spawn fade per chunk, disposal), `instancedFromPoints` / `finalizeInstancedChunk` (assembly + rebase + culling bounds + warm-up), `useSolidDressing` (a collider feature's chunks, spec placement, bodies, distance-gated imperative colliders), `selfPatchedMaterial` (a feature's own program on the shared chunk projection) | a folder with `index.tsx` (its declaration + driver), `spec.ts` (its Three-free placement and colliders, which the server shares) and its own `geometry.ts` / `material.ts` / `shapes.ts` |
| FOLIAGE | `objects/foliage/index.tsx` | the ENTIRE pipeline: chunk lifecycle, worker streaming, the instanced billboard mesh, the shader (billboarding, sway, distance fade, quantization, curvature, spawn fade, night dim), the distance LOD, disposal | `createFoliage({…})` with a plant's art + defaults, every knob overridable at the mount (`foliage/grass/index.tsx` is ~60 lines) |

Rule of thumb: unique geometry, interaction or behavior → actor; many + identical + stateless → dressing; thousands-per-chunk vegetation → foliage. The PARTICLE base (`src/objects/particles/`: GPU-looped instanced quads, one clock uniform) is drawn by `createParticleDressing`, which returns a declaration like any other.

### Systems: the invariants (details and history in the decisions docs)

- **Domains share ONE page and ONE canvas.** No router: URL paths are fake (`pushState` only, `src/world/domains/navigation.ts`). `OverworldDomain` is THE game, one infinite map; every path that is an ADDRESS (`isKnownAddress`) boots it there; `HomeDomain` (`/`) is the landing page, where clicking its CRT drops the player into the overworld from high above the origin's biome cell; every other path is replaced by `/404`, `NotFoundDomain` (a flat white void). A domain switch happens inside ONE persistent `<CustomCanvas>` in two phases (render no domain, `resetDomainSystems()`, mount the new one); the canvas, GL, programs, `<Physics>`, Player, contexts and overlays are never torn down. Per-domain scene state is a `<Domain>` prop (`playerSpawn`); the scene background is the domain `<Skybox>`'s horizon. Entering the overworld (`FastTravel.tsx`) sets a spawn with a drop height: the Player falls toward it while the ground loads; the browser BACK button fires the escape pod (`ESCAPE_POD_EVENT`) and can never unload the game. Home and 404 are flat streaming terrain drawn as a wire grid (`<Terrain wireframe>` + a biome material: 404's `<Material color>`, home's lit by its CRT). → domains/DECISIONS.md
- **The commit.** `<Domain>` walks its own children ONCE (`world/content/`) and publishes the `DomainConfig`, the client LOOK model, the skies and the actor descriptors to the active-domain accessors (`src/world/domains/utils.ts`: `getActiveDomainConfig()`, `getActiveRegions()`, `getActiveSkyboxes()`, `getActiveActors()`, `getTerrainParams()`, `await whenDomainReady()`), then mounts `TerrainRenderer`, `ActorPool`, `SkyboxSystem` and every `Driver` the tree asked for. `world/content/config.ts` is the ONE assembler — the SERVER imports it and runs on the same object, so there is nothing to keep in step and no drift check. `ACTOR_CATALOG` derives from the same trees; ids and names are asserted unique there. `Material`/`Skybox` take their meaning from where they are mounted:
  - under `<Domain>`: the river-bed texture / the default sky
  - under `<Region>`: the BASE material / a sky mixed by region weights
  - under `<Biome>`: the biome frag / a sky override

  `Terrain` is domain-only.
- **Never a biome id or name.** Every biome difference a system keys on is a FEATURE it mounted — its resolved params land in `SerializedBiome.features` under the declaration's kind — or the biome's SHAPE (`isRockBiome`: a domed biome is rock). `utils/workers/biomeFlags.ts` is generic over that map (`biomeIdsWith(kind)`, `biomeFeature(id, kind)`, `featureMounts(kind)`, `isWaterRegion`), and each system exports its own typed accessors beside its component, so deleting a system deletes every mention of it. The bespoke city height branch is the one id the pipeline names, and `roadBearingBiomeIds()` is where it becomes a question everything downstream can ask. → workers/DECISIONS.md
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
- **Bridges are DRESSING, computed geometrically.** A deck exists only where a road genuinely crosses a river, landed on dry road at both ends, continuous with it; deterministic per window; colliders are a trimesh of exactly the drawn ribbon; the terrain is cut under the DRAWN slab; a vertex fetches its cell's decks FIRST (enumerating them evaluates terrain). Keep `WORLD_CHUNK_SIZE` consistent between client and server. → bridges/DECISIONS.md
- **Tunnels (caves, sewers) are WORLD content and an OVERLAY** (`world/underground/`, on the world's streaming chunks — not scenery standing on the ground, but a cut through it): their one height step is the cave MOUTH BULGE (`mouthBulge.ts`, step 10, from caves generated on the un-bulged ground). A cave ENTRANCE is ONE isosurface of ground and tunnel, drawn with the terrain's material fading into rock (`entrance.ts`, `tunnelRock.ts`); the terrain is cut per pixel there and at shafts (`terrainHoles.ts`). The player and every server NPC move by ONE rule set (`physics/tunnelRules.ts`) on a `TunnelSpace` each: heightfields are ignored in a tunnel's air and in a mouth's CUT, where the drawn entrance patch is the collider. Manholes and doors are the SERVER's state. Snow is ONE rule for the near sheet, the terrain's whitening and the wading; rocks a density field per biome plus every mouth's spots, plus the bare boulders of every waterfall and the odd rock in calm water (`rivers/waterfallRocks.ts`, ONE list the `rocks` enumerator draws and the splash enumerator bursts on). → underground/DECISIONS.md, rivers/DECISIONS.md
- **City terrain** (`roads/cityTerrain.ts`):
  - Rotated staggered DISTRICTS, each holding a square block grid (not voronoi), with arterials on the district boundaries.
  - ONE normalized road field drives the shader bands, the curb dip and the spawn filters, and is the global "is a road here" test (mouth fitness, the sewers' on-street nodes). `cityConfig.roadWidth` (7, the half-width) must match the city shader's bands.
  - A fully pairwise LINEAR chamfer.
  - The phase varyings (`vFreewayAlong`, `vDistanceToFreewayCenter`) jump at seams: never paint from them without the `fwidth()` guard.

  → roads/DECISIONS.md
- **Coordinate precision:** generation is float64 on ABSOLUTE coordinates and is never rebased (every seed would change). Rendering is float32 and must never form an absolute world coordinate: build positions as rebase origin + offset, projected through `modelViewMatrix[3]` — every chunk-relative custom program does it through ONE GLSL function, `projectChunkLocal` (`world/shaders/chunkProjection.ts`: the terrain, water, tunnels, snow, rocks, particles). Any world-space period read from `vWorldPosWrapped` must divide `WORLD_WRAP` (4200). `vWorldPosAbs` is for lighting and the terrain holes only. Every instanced dressing chunk goes through `finalizeInstancedChunk`. → COORDINATE_PRECISION.md
- **Workers** are initialized from the first committed config. A domain switch re-inits them by termination.

### Directory Layout

Each README is the reference for its folder's files; this tree is the map. **File naming is uniform
by ROLE, not by feature** (see Conventions): a folder's entry point is `index.ts(x)`, and beside it
only role names — `types.ts`, `constants.ts`, `utils.ts`, `spec.ts`, `params.ts`, `material.ts`,
`geometry.ts`, `worker.ts`. No file is named after the single function it holds.

```
src/
  index.tsx  boot: navigation + connection + ONE persistent <CustomCanvas>; renders DOMAIN_TREES[domain]
  objects/  THE GAME-OBJECT HIERARCHY  objects/README.md
    types.ts  GameObjectAttributes → Actor/Dressing/FoliageAttributes
    actors/  ACTOR class: index.tsx = THE BASE (useActorLifecycle, prepareActorMaterial)  actors/README.md
      ModelActor.tsx  the standard GLTF member (+ the behavior wiring for any spec with a stateMachine)
      spec.ts  ActorSpec / ActorMount (Three-free); catalog.ts = actorCatalogOf; components.ts = ACTOR_COMPONENTS
      modelClonePool.ts, animationPlayer.ts, kinematicMover.tsx
      spawning/  ActorPool, worker.ts (the spawn worker's client), radii, types  spawning/README.md
      state/  the Three-free state machine core + motion/animation/input channels  state/README.md
      colliders/  worker.ts (client) + collider.worker.ts (thread) + useModelColliders (one fixed body)  colliders/README.md
      beeble/  the template NPC: spec.ts + stateMachine.ts (+ inflate.ts, its ascend morph)
      building/  procedural buildings: generatePlan → assets.ts (cache, phased builds) → index.tsx  building/README.md
    dressing/  DRESSING class: index.tsx = THE BASE (instanced assembly + useSolidDressing, on the
                         WORLD's chunk lifecycle); utils.ts = farthest  dressing/README.md
      enumerators.ts  DRESSING_ENUMERATORS (name → placement); catalog.ts = DRESSING_COLLIDER_SPECS; worker.ts
      street-lamps/ road-markers/ traffic-lights/ power-lines/ bridges/ rocks/ snow-drift/ river-banks/
                         one folder each: index.tsx (declaration + driver) + spec.ts + its own art  README each
    particles/  THE particle base: index.tsx (createParticleDressing), chunk.ts, material.ts,
                         + lake-bubbles/ river-splashes/  particles/README.md
    doors/  THE hinged door (leaf geometry, swing, hover), shared by buildings and the sewers  doors/README.md
    sprite-lod/  far billboards (one instanced mesh per look), handed off by spawn-point id  sprite-lod/README.md
    foliage/  FOLIAGE class: index.tsx (pipeline + createFoliage), lod.ts (bands, taper),
                         material.ts (the shader), worker.ts  foliage/README.md
      grass/ seaweed/  the plants
  world/
    place.tsx  WHERE THE PLAYER IS (region, biome, cells, sky weights, ground): one poll, getPlace()/onPlaceChange
    CustomCanvas.tsx  THE canvas (GL context, <Physics>, Player, contexts — never torn down)
    types.ts (the client LOOK model), defaults.ts, constants.ts (CITY_BIOME_ID only)
    VERTEX_JOURNEY.md  one vertex from chunk request to pixel, every step in order
    content/  THE TREE: index.ts (declare, content, the walker), config.ts (THE DomainConfig
                         assembler, Three-free — the server imports it), types.ts  content/README.md
    components/  the declarations: Domain, Region, Biome, Terrain, Noise/Dome/Detail, Water, Rivers,
                         Material, Actor (+ Skybox, in sky/)  components/README.md
    domains/  DOMAIN → REGION → BIOME content  domains/README.md
      index.ts  DOMAIN_TREES, DOMAIN_NODES, DOMAIN_CONFIGS, ACTOR_CATALOG — all read off the trees
      navigation.ts, reset.ts, utils.ts (active-domain accessors)
      overworld/  THE game: index.tsx, address.ts, FastTravel.tsx  overworld/README.md
        regions/<r>/index.tsx + shaders/base.glsl + biomes/<b>/{index.tsx, shaders/fragment.glsl}  regions/README.md
      home/  the landing page: index.tsx, HomeScreen (the click-to-enter gate), HomeTitle, crt/ (the TV: static, solid, its click enters the overworld)  home/README.md
      404/  where unknown paths land: a white void, rare beebles
    terrain/  index.tsx = TerrainRenderer (chunk lifecycle), buildRequests, chunkObjects (plane, water,
                         colliders), chunkGeometry, worker.ts (pool of ≤2), lodConfig, lodQuadtree,
                         lodSwaps + chunkIndex, material.ts, vertexData.ts  terrain/README.md
    shaders/  vertex.glsl, common.glsl, combineBiomeMaterials.ts, lodFade.ts, farFade.ts, terrainHoles.ts,
                         tunnelRock.ts, chunkProjection.ts (every custom program's vertex stage), constants.ts  shaders/README.md
    water/  material.ts (swells, advected noise, falls, the flow)  water/README.md
    underground/  the tunnels: <Caves>/<Sewers>/<Rooms>, their meshes, registry, toggles, worker.
                         Part of the WORLD, not scenery on it — it cuts the terrain  underground/README.md
    chunks/  THE STREAMING GRID: fixed 256u cells the camera drags a window over, on one budgeted
                         queue (useWorldChunks, useChunkAssets, useChunkRegistry) + colliders.tsx.
                         The dressing and the tunnels are both built on it; TERRAIN is not (its
                         chunks are per-LOD). types.ts is Three-free — the server shares it  chunks/README.md
    sky/  Skybox (the <Skybox> declaration + SkyboxSystem), DayNightCycle + celestialBodies  sky/README.md
  lighting/  dayNight.ts channels, DayNightLights, lampGlow (the glow grid), personalLight  lighting/README.md
  physics/  characterMovement.ts — THE capsule resolver (player + server NPCs); movementModifiers.ts  physics/README.md
  player/  Player.tsx, undergroundMode.ts, groundSafetyNets.ts, waterProbe.ts, useInput.tsx, spec.ts  player/README.md
  net/  protocol.ts (THE wire copy), connection, playerData, players/, entities/  net/README.md
  context/  GameContext, DevContext, constants.ts (DEV_TOGGLES)  context/README.md
  menus/overlay/  StatsOverlay, DevOverlay, LogsOverlay, NetOverlay, styles.ts  menus/README.md
  save/  save.ts: ONE JSON save in two stores, device (localStorage) and account (the hosted blob)  save/README.md
  vfx/  PostProcessing, curvature, quantization, spawnFade, dither, frameCap, materialPatch  vfx/README.md
  utils/  math/ (seedRand, seededStream), material/ (textures, fromShader), cursor/, task-queue/,
                         geometry.ts (bakeVertexColor, mergeOrThrow — vertex-colored parts, shared by
                         buildings, doors and tunnels), warmPrograms, uploadOnFirstDraw, contentError,
                         spikeTrace, utils.ts (debugGlobal)  utils/README.md
    workers/  THE HEIGHT PIPELINE (vertexCompute.ts + modules, rivers/ roads/ bridges/ underground/
                         snow/ rocks/, biomeFlags.ts = the generic feature lookup) + the
                         terrain/spawn/foliage/dressing/underground worker threads  workers/README.md
config/jest/  rendererStub.js — what jest maps a worker client to (tests read the tree, never run it)
server/  the game server. build.mjs is THE build: dev watch, prod, tests, and the stub that keeps
                         three.js out of it  server/README.md
LOST_FEATURES.md  what the hierarchy refactor removed, and what it cost
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

- **Presence by mounting** — a thing is in the world because a component is in the tree. No `has_x` flag, no spec list beside the JSX, no name→component registry. A feature's params live on the declaration's `read`, its drawing on its `Driver`, both in its own folder.
- **The walker never calls a component** (`world/content/index.ts`) — it reads `props.children` down the element objects, so views with hooks are walked past and the server can read a tree whose views import Three.
- **A content file exports an ELEMENT**, through `content(<Biome …>…</Biome>)` — never a function that builds one, which the walker could not see into.
- **Config literals**: every prop `world/content/config.ts` reads must be a literal or a Three-free constant. The server's build stubs three.js, so a value computed from a three.js object would silently become a proxy in its config.
- **Utility namespaces** (material patchers + texture loading only): `_material.loadTextures()`, `_quantization`, `_curvature`. Math helpers are plain exports (`seedRand`, `smoothstep` from `utils/math/`; `seededStream` for many draws from one seed)
- **Worker clients extend `createWorkerClient`** (`utils/workers/workerClient.ts`) and live at `<feature>/worker.ts` — never hand-roll a pending map / INIT handshake / terminate; a client file is only its typed request wrappers.
- **Density placement has ONE implementation** (`utils/workers/densityGrid.ts`), shared by the spawn worker, the flatten-pad engine and the dressing worker (that is what keeps pads under buildings); a dressing placement names a `feature` instead of `biomeIds`, so the points stand in whichever biomes mounted it. `passesPlacementFilters` rejects every point within `riverKeepOff()` of a river for EVERY object.
- **Content mistakes are loud**: every check of a mount, shader or machine reports through `reportContentError` (`src/utils/contentError.ts`: throws outside production, logs in it). Use it for any new check.
- **Biome shaders**: each biome/region fragment shader becomes a named function; `combineBiomeMaterials` mixes them per pixel from the `vBiomeSdf0/1` / `vBiomePresence0/1` varyings (no biome id in the shader); the vertex shader is shared
- **Geometry pooling**: `acquireGeometry()`/`releaseGeometry()` recycle BufferGeometry per LOD level
- **Voronoi caching**: grids, triangulations, wall lists and sites are memoized (on grid identity / per cell); never rebuild the wall arrays per vertex. → workers/DECISIONS.md
- **DomainConfig** (`world/content/config.ts`): the serializable config the workers and the server run on — regions and biomes (base noise, riverProbability, water, each biome's `features` map of resolved params, blend widths), the `<Terrain>` params, biome noise, flatten descriptors (from the `<Actor>` mounts), city config

## Adding Content

Each flow's checklist lives in the README of the folder it touches; this table says where, and what it costs. Mistakes are LOUD in dev (`reportContentError`): a declaration mounted in the wrong parent, duplicate ids/names, shader clashes, bad state machines, unplaced server actors, unwarmed programs.

| to add | files | checklist |
|---|---|---|
| a biome | 2 new (`index.tsx`, `shaders/fragment.glsl`) + 1 line in its region | [regions/README.md](src/world/domains/overworld/regions/README.md) |
| a region | 2 new + its biomes + 1 line in the domain | same |
| a lake-type biome | a `<Water depth>` in the biome | [water/README.md](src/world/water/README.md) |
| a bespoke-height biome (like the city) | a biome with no `<Noise>` + a branch in the pipeline | [workers/README.md](src/utils/workers/README.md) |
| rivers under a region | `<Rivers chance>` in it (none = no rivers there) | [rivers/DECISIONS.md](src/utils/workers/rivers/DECISIONS.md) |
| a static prop | 1 new (`spec.ts`) + `<Actor actor={SPEC}/>` in a biome (+ the GLB) | [actors/README.md](src/objects/actors/README.md) |
| an NPC | 2 new (`stateMachine.ts`, `spec.ts`) + `<Actor>` in a biome — mounting it IS cataloging it; nothing on the server | same, and [NPC_TRACKING.md](NPC_TRACKING.md) §6 |
| an NPC with scene logic | + 1 component registered in `ACTOR_COMPONENTS` / `ActorComponentName`, named by `component` on the spec; `withModelActorWarmup` | [actors/README.md](src/objects/actors/README.md) |
| a building variant | 2 edits: a spec in `building/spec.ts` + an `<Actor>` mount (flatten pads and the server's hull follow) | [building/README.md](src/objects/actors/building/README.md) |
| a far sprite | `spriteLod` on the spec + a describer + a `SpriteLook` | [sprite-lod/README.md](src/objects/sprite-lod/README.md) |
| tunnels under a biome | `<Caves>` / `<Sewers>` in it, `<Rooms>` inside, `<Actor>`s inside that; nothing else | [underground/README.md](src/world/underground/README.md) |
| snow / rocks on a biome | `<Snow/>` / `<Rocks …/>` in it | [snow-drift/README.md](src/objects/dressing/snow-drift/README.md), [rocks/README.md](src/objects/dressing/rocks/README.md) |
| a per-biome parameter of a feature | 1 field on its params type + its default in that feature's `params.ts` | [workers/README.md](src/utils/workers/README.md) |
| a particle effect | a `ParticleLook` + a Three-free emitter enumerator (+ 1 `DRESSING_ENUMERATORS` line, a test) + 1 `createParticleDressing` member + 1 mount | [particles/README.md](src/objects/particles/README.md) |
| a plant | 1 new folder (`index.tsx` = `createFoliage`) + 1 mount; its own `seed` | [foliage/README.md](src/objects/foliage/README.md) |
| a dressing feature | 1 new folder (`index.tsx` = `declare({kind, within:"biome", read, Driver})`) + 1 mount; + an enumerator function, its re-export, one `DRESSING_ENUMERATORS` entry and a test | [dressing/README.md](src/objects/dressing/README.md) |
| …solid (client + server colliders) | + a Three-free `spec.ts` + 1 `DRESSING_COLLIDER_SPECS` line; the driver calls `useSolidDressing` | same |
| a skybox | 1 `<Skybox>` line in a domain, region or biome | [sky/README.md](src/world/sky/README.md) |
| a glow source / glow color | `registerLampHeads(...)` + its disposer / 1 `LAMP_COLORS` entry | [lighting/README.md](src/lighting/README.md) |
| an overlay | 1 new file (styles from `menus/overlay/styles.ts`) + 1 mount | [menus/README.md](src/menus/README.md) |
| a dev toggle | 1 `DEV_TOGGLES` entry | [context/README.md](src/context/README.md) |
| a saved field | 1 `SaveData` field + `saveToDevice`/`saveToAccount` | [save/README.md](src/save/README.md) |
| a world-wide VFX | a patcher in `vfx/` + a `<PostProcessing>` prop + a `VFX_KNOBS` entry (devmode's live slider) + the six class-base call sites | [vfx/README.md](src/vfx/README.md) |
| a network message | `protocol.ts` + server validation/handler + a client sender/listener | [net/README.md](src/net/README.md) |
| a domain (a separate page; today `home` and `404`) | 1 new `index.tsx` (its tree) + `DOMAIN_IDS` and `DOMAIN_TREES` entries + its path in `navigation.ts` | [domains/README.md](src/world/domains/README.md) |

Rules no checklist can enforce:
- **Adding a region or a biome MOVES THE MAP.** The region roll is `floor(u × count)` over the `<Region>` children and the biome roll over each region's `<Biome>` children: appending one re-rolls every cell of that grid and every address. Do it before anyone has linked to an address, or accept it knowingly.
- **Pick the object class first** (see "The three game-object classes"): lamps built as actors cost 10–20 fps.
- **A shared behavior goes in the class base**, never into one member; a new world-wide effect is applied from the bases only.
- **A biome shared by two regions** is its folder duplicated under the second region with a new element name and the SAME `id`; its visual children render once per copy, and the shader fades it into the base of only the FIRST region listing it (`biomeSlotRegionsOf`).
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
- **FILE NAMES SAY THE ROLE, FOLDERS SAY THE FEATURE.** A folder is one feature; its entry point is
  `index.ts(x)`, and every other file beside it is named for what KIND of thing it holds, never for
  the feature (the folder already said that) and never for a single function it exports. The
  vocabulary, used the same way everywhere:

  | file | holds |
  |---|---|
  | `index.ts(x)` | the feature itself: its component/declaration, or its base |
  | `types.ts` | its interfaces and type aliases |
  | `constants.ts` | its fixed numbers |
  | `defaults.ts` | the values its props fall back to |
  | `params.ts` | a feature's kind, its defaults and its biome accessors (Three-free) |
  | `spec.ts` | its Three-free description, shared with the server (placement, colliders) |
  | `utils.ts` | small helpers with no better home |
  | `material.ts` / `geometry.ts` / `shapes.ts` | its art |
  | `worker.ts` | its worker CLIENT; `<name>.worker.ts` is the thread |
  | `<name>.test.ts` | tests, beside what they test |

  So: `street-lamps/{index.tsx, spec.ts, geometry.ts}`, not `StreetLamps.tsx` + `lampSpec.ts` +
  `lampGeometry.ts`. If a file would be named after one function, either merge it into the
  folder's `index` or give it a role name with the rest of that role's code.
- **Comments are for what the code cannot say.** Prefer a descriptive name. A comment earns its place ONLY for a magic value (units, provenance), a non-obvious WHY (a rejected alternative, a measurement, an invariant another file depends on, a hazard) or genuinely confusing logic. Never restate the next line, narrate history or duplicate this file. When in doubt, cut it.
- **The horizontal plane is x/z, everywhere** — `y` is always height, inside 2D code too (voronoi, city grid, density placement, chunk offsets): `PointXZ` / `RectXZ` (`utils/math/types.ts`) and `ix/iz`, `dx/dz`, `sx/sz` names, never `THREE.Vector2` or `.y` for a horizontal coordinate. The ONLY `(x, y)` pair is the abstract 2D noise samplers (`simplex2`/`perlin2`/`terrainNoise` in `utils/workers/noise.ts`), whose inputs are not world axes
- **Hierarchy ownership**: DOMAIN → REGION → BIOME is both the content and the folder hierarchy — code lives at the level it belongs to; only genuinely shared code lives outside `world/domains/`
- **Presence by mounting**: a thing exists BECAUSE its component is mounted under its owner, an optional part is a CHILD, its knobs are props. No `<Sewers>`, no sewers; no `<Rooms>`, no side rooms. Never a flag restating a mount, and never a parameter where a component would do. DOMAIN → REGION → BIOME → FEATURE → PART.
- **Extend, don't duplicate**: every game object extends its CLASS BASE (`objects/actors/index.tsx`, `objects/dressing/index.tsx`, `objects/foliage/index.tsx`) plus the shared attribute types (`objects/types.ts`); actor variants spread a base descriptor
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
