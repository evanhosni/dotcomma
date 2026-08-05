# dotcomma

An exploration-based procedurally-generated 3D game built on React Three Fiber. Players explore infinite terrain across diverse biomes and encounter spawned NPCs/objects. The codebase is designed to be modular — new biomes, regions, spawns, and systems should be easy to add without touching core infrastructure.

> **Maintenance note:** This file is NOT auto-updated. When you add new systems, rename directories, change conventions, or make architectural changes, ask Claude to update CLAUDE.md to reflect them.

## Tech Stack

- **React 18** + **TypeScript** (strict mode)
- **Three.js** via `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier` (physics)
- **React Router** (`react-router-dom`) for client-side routing
- **Craco** (CRA + webpack customization, `.glsl` files loaded as raw assets)
- **Web Workers** for heavy computation (Voronoi/Delaunay, terrain data)
- **Noise**: `noise-ts` (Simplex/Perlin), `seedrandom` (deterministic RNG)
- **Delaunator** for Voronoi diagrams

## Commands

- `npm start` — dev server (craco)
- `npm run build` — production build
- `npm test` — jest tests
- `npx tsc --noEmit` — type check

## Architecture

### Content Hierarchy — everything is a component

```
<World>                      // global rulesets + systems
  <Terrain/>                 //   global terrain rules (seed, grid sizes, base/road noise, city config)
  <Material/>                //   river texture (between regions)
  <Skybox/>                  //   default sky
  <PostProcessing/>          //   global post-processing
  <Region>                   // one per region, JSX order = voronoi order
    <Material/>              //   biome-boundary texture for this region
    <Biome>                  // one per biome (flags: joinable/blendable/blendWidth)
      <Terrain/>             //   biome height config (noise params — single source of truth)
      <Material/>            //   biome fragment shader (getMaterial)
      <Spawnables>           //   groups spawnables; its props are shared defaults for children
        <BeebleSpawnable/>   //   per-object component wrapping <Spawnable> (props = overrides)
      </Spawnables>
      <GrassField/>          //   always-mounted visuals (auto-scoped to the biome)
      <Skybox/>              //   optional per-biome sky override (also valid at Region level)
    </Biome>
  </Region>
</World>
```

The world is defined by the `GameWorld` component tree in `src/world/world.tsx`. Config components (`Region`, `Biome`, `Terrain`, `Material`, `Skybox`, `Spawnable` — all in `src/world/components/`) register into a store during layout effects; `<World>` then **commits** the assembled `Region[]` data + serializable `WorldConfig` to a module-level registry (`src/world/registry.ts`) and mounts the global systems (`TerrainRenderer`, `ObjectPool`, `SkyboxSystem`). Non-React code (workers init, voronoi client, Player) reads from the registry — `getActiveRegions()`, `getActiveWorldConfig()`, `getWorldTerrainParams()`, or `await whenWorldReady()`.

`Terrain`/`Material`/`Skybox` are **scope-aware**: their meaning depends on whether they're mounted under `World`, `Region`, or `Biome` (see the tree above). Skyboxes cross-fade as the player moves between scopes (biome wins over region wins over world); the current biome is polled off-thread via the voronoi worker only when scoped skyboxes exist.

Voronoi diagrams assign regions/biomes to world coordinates. Terrain blends at biome boundaries using distance-to-wall calculations.

**Heights have a single source of truth**: `src/workers/vertexCompute.ts` is the ONLY height implementation. The terrain, spawn, and grass workers run it off-thread; the main thread (`src/world/vertexData.ts`, used by Player respawn) imports and runs the SAME module, initialized with the same serialized `WorldConfig` from the registry. Biome heights are defined declaratively via the biome-level `<Terrain noise={…}>` config; biomes with bespoke height logic (city — flat, base-noise-cancelling) have their branch inside `vertexCompute.ts`. Never add a second height code path.

**Performance note:** this is a *declarative shell* over the same pipeline as before — all heavy work still runs in web workers, and worker configs are built once at commit. Workers are initialized with the first committed config; registrations added after the first commit update the registry but do not re-init running workers.

### Directory Layout

```
src/
  spawnables/          # Spawnable objects — kept separate from biomes because one
    beeble/            #   spawnable may exist in multiple biomes. Each folder has the
    big-beeble/        #   object component (+ optional stateMachine.ts) and spawnable.tsx
    xl-element/        #   (SpawnDescriptor + <XxxSpawnable> wrapper component)
    xxl-element/
    apartment/
    building/          # Procedural building: seeded exterior massing with the
                       #   backrooms-style BSP interior physically nested inside;
                       #   clickable hinged doors gate interior mounting
                       #   (generatePlan.ts → buildingAssets.ts cache → Building.tsx)
    building1/
  world/
    GameWorld.tsx      # GameWorld — the <World> tree, single source of truth for active content
    registry.ts        # Module-level active world (regions/params/WorldConfig) + whenWorldReady()
    regions/           # Each region owns its folder: region.tsx + its biomes.
      city/            # Region file is always region.tsx, biome file is always biome.tsx —
        region.tsx     # the folder path identifies which is which. There is NO shared
        biomes/        # biomes folder — a biome used by several regions is DUPLICATED
          city/        # into each region under a distinct component name (e.g.
          grass/       # CityGrassBiome / GrassBiome, both biome id 3).
                       # city/: urban biome (id:1) — biome.tsx, shaders (height: city branch in vertexCompute.ts)
                       # grass/: grassland biome (id:3) — biome.tsx (duplicate of grass region's)
      desert/
        region.tsx     # Desert region (dust biome)
        biomes/dust/   # Desert biome (id:2) — biome.tsx (noise config), shaders
      grass/
        region.tsx     # Grass region
        biomes/grass/  # Grassland biome (id:3) — biome.tsx
      index.ts
    types.ts           # Region, Biome (data model), BiomeNoiseConfig, VertexData, MaterialData
    components/        # The declarative world component system
      World.tsx        # Registration store + commit → registry; mounts global systems
      Region.tsx       # Region declaration + RegionContext
      Biome.tsx        # Biome declaration + BiomeContext
      Terrain.tsx      # Scope-aware terrain rules (world params / biome noise config)
      Material.tsx     # Scope-aware materials (river / region boundary / biome shader)
      Skybox.tsx       # Scope-aware skybox registration + SkyboxSystem (cross-fading sky)
      Spawnable.tsx    # <Spawnable> descriptor registration + <Spawnables> defaults group
      context.ts       # WorldStore, WorldStoreContext, RegionContext, BiomeContext
    vertexData.ts      # Main-thread adapter over workers/vertexCompute.ts (same pipeline, same config)
    material.ts        # Combines all biome fragment shaders, reads registry
    shaders/           # Shared vertex shader
    terrain/
      TerrainRenderer.tsx # Chunk lifecycle, LOD quadtree, build loop, geometry pool
      lodConfig.ts     # LOD levels, chunk sizes, segment counts, render distances
      types.ts         # Chunk, TerrainProps
  workers/
    vertexCompute.ts   # Shared inlined vertex pipeline (noise, voronoi, city, biome heights)
    buildWorldConfig.ts # Serializes regions into WorldConfig for workers
    terrain.worker.ts  # Off-thread chunk height computation
    spawn.worker.ts    # Off-thread spawn point generation
    grass.worker.ts    # Off-thread grass blade placement (coarse height grid + bilinear interp)
  objects/
    GameObject.tsx     # GLTF model loader with colliders + animations (handles own position when no positionRef)
    vegetation/
      GrassField.tsx   # Instanced billboard grass (GPU sway, per-chunk draw calls, spawn-style filter props)
      grassWorker.ts   # Worker client for grass.worker.ts (shared across GrassField instances)
      types.ts         # GrassFieldProps
    spawning/
      ObjectPool.tsx   # Spawn management, frustum culling, pooling
      collectDescriptors.ts # Aggregates SpawnDescriptors from regions/biomes
      generateSpawnPoints.ts # Worker client for spawn generation
      SpawnSpatialHash.ts # Grid-based spatial hash for spacing
      types.ts         # SpawnDescriptor, SpawnPoint, SpawnedObjectProps
    colliders/         # Physics collider components
    state/             # State machine, mouse events, triggers for interactive objects
    frustumVisibility.ts # Shared set of frustum-hidden objects (portals restore them for off-screen renders)
  portals/
    Building.tsx       # Spawnable building: exterior + always-mounted interior at an indoor Y slot, paired portals
    Portal.tsx         # Portal surface (door mesh + crossing-time protection box) — registers a static PortalDescriptor
    PortalContext.tsx  # Portal registry, activeIndoorId, indoor bounds registry
    PortalTeleportSystem.tsx # ONE useFrame for all portals: camera plane-crossing detection + teleport
    usePortalRenderer.ts # Render-to-texture virtual camera (oblique clipping, adaptive res, throttling)
    portalMath.ts      # Shared pair-transform math (dest * rotY180 * inv(src)), near-plane corner distance
    portalAssets.ts    # Per-building-type cache: portal transforms + interior template
    IndoorLightRig.tsx # Fixed-count global indoor lights (stable shader variants)
    indoorSlotAllocator.ts # Unique Y slot per building instance (INDOOR_Y_OFFSET + slot spacing)
    constants.ts       # Teleport thresholds, render perf tuning
  sky/
    DayNightCycle.tsx  # Jittery low-poly sun (flat irregular disc) + crescent moon +
                       #   stars; follows the camera; drives the night blend
    dayNight.ts        # Cycle durations, DAY_NIGHT_CYCLE_TRANSITION_MS, night palette,
                       #   nightBlend channel (read by SkyboxSystem)
  player/
    Player.tsx         # First-person controller + physics
    useInput.tsx       # Keyboard input
  utils/
    utils.ts           # getAllBiomes, getDistance2D (plain exports)
    voronoi/           # Web worker Voronoi system (voronoi.ts queues, .worker.ts computes)
    noise/_noise.ts    # Perlin/Simplex FBM wrapper (TerrainNoiseParams)
    math/_math.ts      # seedRand, lerp, smoothstep, randRange
    material/          # Texture loading, biome material composition
    task-queue/        # Async task queue
    quantization/      # Vertex quantization for material patching
    cursor/            # DOM cursor overlay
  canvas/              # Three.js canvas + physics world setup
  context/             # GameContext (player position, terrain loading state)
  menus/               # Overlay, command palette, logs overlay
  vfx/                 # Post-processing effects
```

### Terrain Pipeline

1. Player position → `computeDesiredChunks()` (quadtree LOD)
2. New chunks queued → `BuildChunk()` async generator
3. Per-vertex: worker uses `WorldConfig` → voronoi → biome height + blend
4. Geometry buffers written, normals computed, skirt vertices set
5. Chunk made visible via atomic LOD swap system

### Portal System

Buildings pair an outdoor "enter" portal with an indoor "exit" portal; interiors live at `INDOOR_Y_OFFSET` (+ per-instance slot spacing) directly above the building so terrain streaming is unaffected. Seamless walk-through uses the Valve/Portal technique:

- **One shared transform** (`portalMath.ts`): `dest * rotY(180°) * inv(src)` drives BOTH the portal preview (virtual camera) and the teleport, so the frames before/after crossing are pixel-identical.
- **Near-plane protection**: the portal surface is normally the door-shaped GLTF mesh, but while the camera is within near-plane-corner distance of the door plane it swaps to a box extruded through the plane away from the camera — the near plane can never clip a hole through it. The projective texture is screen-space, so both surfaces render identical pixels; the swap is invisible.
- **Camera-crossing teleport** (`PortalTeleportSystem.tsx`, single `useFrame` at priority -2): fires the instant the camera crosses the plane inside the door frame; applies the pair transform to body + camera synchronously, then hands plane-tracking to the destination portal. No transition guards or physics freezes.
- **Oblique near-plane clipping** (Lengyel) hides geometry behind the destination portal; the clip plane is kept at least `NEAR_CLIP_LIMIT` from the virtual camera (clamped, not skipped) to avoid degenerate-projection flicker.
- **One level of recursion via context mode**: when the player is near an enter portal, every exit portal of that building renders the exterior observed by that enter portal's virtual camera (`contextEnterId`, set by the teleport system) — so other doors visible inside a preview show the outside. During any portal RT render, foreign portal surfaces whose texture matrix was built for a different observer are hidden (screen-space projective textures are only valid for their own observer).
- `useFrame` priority order: portal transform refresh (-4, in Portal.tsx) → Player (-3) → teleport (-2) → object culling (0) → exit-portal RTs (0.9) → enter-portal RTs (1) → explicit scene render (2, `SceneRender` in CustomCanvas).

### Key Patterns

- **Declarative world, data-model core** — content is declared as JSX (`GameWorld` in `src/world/GameWorld.tsx`), but the commit produces the same plain `Region[]`/`Biome[]` data model (`src/world/types.ts`) the pipeline always used. Non-React code reads it from `src/world/registry.ts` (`getActiveRegions()`, `getActiveWorldConfig()`, `await whenWorldReady()`).
- **Scope-aware config components** — `<Terrain>`, `<Material>`, `<Skybox>` mean different things under `<World>`, `<Region>`, or `<Biome>` (they read `RegionContext`/`BiomeContext`). Registration components render `null`; visual components (e.g. `GrassField`) render normally.
- **Registration effects use stringified deps** — inline object props (noise params, descriptors) are registered under `JSON.stringify` deps so parent re-renders don't re-commit the world.
- **Utility namespaces**: `_noise.terrain()`, `_math.seedRand()`, `_material.loadTextures()`, `voronoi.create()`
- **Plain utility exports**: `getAllBiomes()`, `getDistance2D()` from `src/utils/utils.ts`
- **Biome shaders**: fragment shaders branch on `vBiomeId` varying; vertex shader is shared
- **Geometry pooling**: `acquireGeometry()`/`releaseGeometry()` recycle BufferGeometry per LOD level
- **Vertex budget**: terrain builds multiple small chunks per frame (LOD3-5) up to a budget limit
- **Voronoi caching**: grid results, Delaunay triangulations, and wall boundary data are cached with spatial eviction
- **WorldConfig**: serializable config sent to workers (`buildWorldConfig(regions, params)`) containing region/biome data, global terrain params (from the world-level `<Terrain>`), per-biome noise (from biome-level `<Terrain noise={…}>`), and city config

## Adding Content

### New Biome

1. Create the biome folder: `src/world/regions/<region>/biomes/<name>/`. If another region needs the same biome, duplicate the folder there under a distinct component name (e.g. `CityGrassBiome` vs `GrassBiome`) with the SAME biome `id` — there is deliberately no shared biomes folder
2. Create `material.ts` — exports `getMaterial`: returns `{ uniforms, fragmentShader }`
3. Create `shaders/fragment.glsl` — define a `<name>_frag()` function
4. Export a `<NameBiome>` component in `biome.tsx` (see `src/world/regions/desert/biomes/dust/biome.tsx` for the minimal template):
   ```tsx
   export const NameBiome = () => (
     <Biome name="name" id={N} joinable blendable>
       <Terrain noise={{ params: {...} }} />
       <Material getMaterial={getMaterial} />
       {/* <Spawnables>…</Spawnables>, <GrassField … />, <Skybox … /> as needed */}
     </Biome>
   );
   ```
   The `noise` prop is the biome's ONLY height definition — the shared pipeline (`workers/vertexCompute.ts`) evaluates it on workers and main thread alike, so there is nothing to keep in sync. A biome needing bespoke height code (like the city) omits `noise` and adds a branch in `vertexCompute.ts` instead.
5. Mount it inside a region component

The combined fragment shader branch, voronoi biome lookup, and worker noise config are all derived from the registrations — no core files to touch.

Note on duplicated biomes: registrations (terrain rules, materials, spawnables) for the same biome `id` are merged into one biome data object at commit, so duplicates must be kept in sync manually (a divergence would silently resolve last-registration-wins). *Visual* children (e.g. `GrassField`) are NOT merged — if two regions with the same duplicated biome are mounted at once, each duplicate renders its own grass; be mindful of that cost when mounting multiple regions that duplicate a biome.

### New Region

1. Create `src/world/regions/<name>/region.tsx` (region-exclusive biomes go in `src/world/regions/<name>/biomes/`):
   ```tsx
   export const NameRegion = () => (
     <Region name="name" id={N}>
       <Material texture="boundary.jpg" />
       <SomeBiome />
     </Region>
   );
   ```
2. Export it from `src/world/regions/index.ts` and mount it inside `GameWorld` (`src/world/GameWorld.tsx`). Region JSX order matters — voronoi assignment depends on it.

### New Spawn/NPC

**Static objects** (no custom behavior — just a model at a position):
1. Create `src/spawnables/<name>/` with a `spawnable.tsx` exporting a `SpawnDescriptor` (set `model` GLTF path and `scale`) plus a `<XxxSpawnable>` component wrapping it: `export const XxxSpawnable = (overrides: Partial<SpawnDescriptor>) => <Spawnable {...XxxDescriptor} {...overrides} />` — spawn restrictions (`biomeIds`, `heightRange`, `slopeRange`, `density`, spacing) are descriptor props; `biomeIds` unset means "spawns in every biome"; `quantization` overrides the global vertex-quantization grid size for this object (unset = global). Spawnables live outside biome folders because one spawnable may be mounted in several biomes.
2. Mount it inside a biome's `<Spawnables>` group (props on `<Spawnables>` are shared defaults for all children; a child's own props win)
3. Place GLTF model in `public/models/`

**Grass / mass vegetation** (thousands of instances — too many for the spawn system):
1. Mount `<GrassField>` (`src/objects/vegetation/GrassField.tsx`) directly inside the biome component — it auto-restricts to the enclosing biome via `BiomeContext` (pass `biomeIds` explicitly to override)
2. Filter props (`density`, `heightRange`, `slopeRange`/`slopeBlend`) plus visuals (`color`, optional `png` billboard texture, `bladeWidth`/`bladeHeight`, `sway`/`swaySpeed`, `renderDistance`, `quantization` to override the global vertex-quantization grid)
3. Placement runs in `grass.worker.ts`; rendering is one instanced, camera-facing, GPU-swaying draw call per 32-unit chunk

**Procedural buildings** (seeded shape, real nested interiors, clickable doors — no GLTF, no portals):
1. `src/spawnables/building/` — `<Building>` generates a deterministic building from a seed (default: spawn coordinates), interior-first: rooms-per-floor × floors set the interior area, which sets the exterior footprint and height (so the shell realistically wraps the inside). Exterior: 4–8-sided masses — boxy slabs or rotated faceted canisters — grayscale segments with occasional accent colors, lips/bulges, gentle lean, scattered oval/skewed-quad windows, rooftop caps + crooked pipes; colors baked as vertex colors so all buildings share one material.
2. Exterior and interior are ONE building, both always rendered: the shell has REAL THICKNESS — the outer surface leans/tapers/bulges freely, while the INNER surface is a straight PRISM of the interior polygon through the occupied floors (the wall cavity between them varies in thickness). A constant inner surface means BSP split walls extend EXACTLY to it at every story: a two-room floor is one dividing wall running exterior-to-exterior, never an enclosed room-within-a-room (wall ends on the BSP domain boundary are stretched to the polygon via `ringSpanAt`, tucked into the cavity; the ramp shaft is OPEN — no enclosing walls — but its rect is excluded from the BSP domain so no divider crosses the ramp or slab holes). Door openings get jamb reveals closing the cavity, and doors auto-nudge along their edge away from wall ends that dead-end into the perimeter. The interior renders as a single merged vertex-colored UNLIT mesh (walls, polygon slabs with the shaft hole, ramps, light panels); interior colors derive from the exterior ground-segment color (floor darker, ceiling lighter) and are overridable via the `interiorColors` option. The plan generator clamps outer-shell rings through the occupied floors (apothem-corrected for polygons, including an inserted ring exactly at `interiorTop`) so the shell never cuts inward — shape runs free above the top floor. The shell carve, inner carve, and door leaf share the same ring edge + param.
3. Door mechanic: each opening holds a real hinged door leaf (closed = extra cuboid collider). Clicking it (screen-center raycast ≤6u, cursor grows on hover) swings it open. Only dynamic content is gated: children (spawnables in rooms) mount within ~150u, all colliders within ~120u. This replaces the old portal pair entirely; `src/portals/` remains for the GLTF `portals/Building.tsx` path.
4. Building variants (apartment/office/theater/…) wrap `<Building>` with their own options — every randomization knob is a prop with a seeded default: `exteriorSize`, `heightRange`, `numberOfSides` (default [4,5,6,7,8]), `palette`/`accentColors`/`accentChance`, `windowShapes` (WINDOW_SHAPE enum; default [SQUARE], CIRCLE opt-in), `windowCount` (array of count choices), `windowSize`, `maxLean`, `stories`, `roomCount`, `doorCount`, `doorSize`, `ceilingHeight`, `materials` — plus children, which render at seeded positions inside rooms across stories. First variant: `Skyscraper` (`skyscraper.tsx`) — 6 stories under a 70–115u shell.
5. Geometry is cached per seed in `buildingAssets.ts`; interior wall boxes double as cuboid colliders; the exterior render triangles double as the trimesh collider (door openings included).
6. Register via `<BuildingSpawnable biomeIds={[CITY_BIOME_ID]} />` (currently city-only).

**Interactive objects** (physics, state machines, custom logic):
1. Create `src/spawnables/<name>/` with the object component (+ `stateMachine.ts` if needed)
2. Use `GameObject` for GLTF loading + colliders, `useStateMachine` / `useMouseEvents` for behavior
3. Add a `spawnable.tsx` with a `SpawnDescriptor` (its `component` = your custom component) and a `<XxxSpawnable>` wrapper; mount it in a biome's `<Spawnables>` group (see `src/spawnables/beeble/`)
4. Place GLTF model in `public/models/`

### Per-Region / Per-Biome Skybox

Mount `<Skybox topColor=… horizonColor=… bottomColor=… />` inside a `<Region>` or `<Biome>`. The `SkyboxSystem` cross-fades sky colors as the player moves (biome-scoped wins over region-scoped wins over the world default). The current biome is polled off-thread via the voronoi worker only when scoped skyboxes exist; only the world-level skybox's `radius` is used.

## Performance Notes

- **Voronoi batch size** (`MAX_BATCH_SIZE` in `voronoi.ts`) is 10. Increasing it causes frame drops because the worker blocks too long on large batches.
- **Terrain vertex budget** (`MAX_VERTS_PER_FRAME` in `TerrainRenderer.tsx`) is 2500. This lets many small LOD chunks build per frame while capping main-thread work.
- Voronoi worker uses O(n) nearest-entry scans instead of sorting. Grid arrays are never mutated by lookups.
- Delaunay triangulations are cached via `WeakMap` keyed by grid array identity.
- Cache eviction in the worker only runs on cache misses, not every query.
- `getDistanceToWall` uses inline segment-distance math (no THREE object allocations).
- `BuildChunk` reads position buffers directly as Float32Array (no Vector3 per vertex).
- **Animation LOD** (`GameObject.tsx`): mixers don't update while frustum-culled and run at half rate past 40% of render distance; skipped time accumulates (capped) so loops stay continuous.
- **Beeble physics LOD** (`Beeble.tsx`): idle grounded beebles skip the character-controller shape cast entirely; beyond `PHYSICS_FULL_RATE_DIST` (80u) moving beebles resolve collisions every 3rd frame with accumulated dt (speed preserved).
- **GameObject fades** write material opacity only when it changes (steady-state objects skip the loop).
- Skeleton cloning on spawn indexes bones by name in one pass (`cloneModelWithAnimations`) — avoid per-bone scene traversals.

## UI / Overlay Styling

All overlays, menus, and HUD elements should follow the established style set by the stats overlay (`Overlay.tsx`) and command palette (`CommandPalette.tsx`):

- **Font**: `'Kode Mono', 'Courier New', Courier, monospace` — 12px, line-height 1.5
- **Color scheme**: green-on-black terminal aesthetic — text `#0f0`, backgrounds `rgba(0,0,0,0.6)` to `rgba(0,0,0,0.85)`
- **Containers**: `border-radius: 4px`, `padding: 8px 12px`, `pointer-events: none` for passive overlays
- **Selection/hover highlights**: `rgba(0,255,0,0.15)` background
- **Inputs**: transparent background, no border except `1px solid #0f0` bottom, inherit font
- **Graphs/sub-elements**: `border-radius: 2px`, `rgba(0,0,0,0.4)` background
- **Positioning**: `position: fixed`, use `z-index: 1000` for HUD overlays, `z-index: 9999` for modal overlays with backdrop
- **Inline styles preferred** — overlays use JS style objects (not CSS modules) since they're built imperatively or need dynamic values

## Conventions

- PascalCase for components/types, camelCase for utilities/functions/properties
- SCREAMING_SNAKE_CASE for constants and enums
- Feature-based directory structure — co-locate assets (shaders, textures) with their biome/feature
- Prefer editing existing files over creating new ones
- Keep biome implementations self-contained; don't add cross-biome dependencies
- Interfaces live in the nearest `types.ts` (world-level types in `src/world/types.ts`)
