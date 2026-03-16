# dotcomma

An exploration-based procedurally-generated 3D game built on React Three Fiber. Players explore infinite terrain across diverse biomes and encounter spawned NPCs/objects. The codebase is designed to be modular — new biomes, regions, spawns, and systems should be easy to add without touching core infrastructure.

> **Maintenance note:** This file is NOT auto-updated. When you add new systems, rename directories, change conventions, or make architectural changes, ask Claude to update CLAUDE.md to reflect them.

## Tech Stack

- **React 18** + **TypeScript** (strict mode)
- **Three.js** via `@react-three/fiber`, `@react-three/drei`, `@react-three/cannon` (physics)
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

### Content Hierarchy

```
Region[] → Biome[]
```

The world is defined by a flat list of regions (`WORLD_REGIONS` in `src/world/world.ts`). Each region contains biomes. Voronoi diagrams assign regions/biomes to world coordinates. Terrain blends at biome boundaries using distance-to-wall calculations. World-level `getVertexData` and `getMaterial` live in `src/world/`.

### Directory Layout

```
src/
  biomes/              # All biome implementations
    city/              # Urban biome (id:1) — blocks, creatures, shaders
    grass/             # Grassland biome (id:3)
    dust/              # Desert biome (id:2)
    pharma/            # Pharmasea biome (id:4)
  regions/             # Region definitions (contain biome lists)
    CityRegion.ts      # City region (city + grass biomes)
    DesertRegion.ts    # Desert region (dust biome)
    GrassRegion.ts     # Grass region (grass biome)
  world/
    world.ts           # WORLD_REGIONS — single source of truth for active regions
    types.ts           # Region, Biome, Block, VertexData, MaterialData
    getVertexData.ts   # World-level terrain pipeline (voronoi → biome heights)
    getMaterial.ts     # Combines all biome fragment shaders
    shaders/           # Shared vertex shader
    terrain/
      Terrain.tsx      # Chunk lifecycle, LOD quadtree, build loop, geometry pool
      lodConfig.ts     # LOD levels, chunk sizes, segment counts, render distances
      types.ts         # Chunk, TerrainProps
  workers/
    vertexCompute.ts   # Shared inlined vertex pipeline (noise, voronoi, city, biome heights)
    buildWorldConfig.ts # Serializes regions into WorldConfig for workers
    terrain.worker.ts  # Off-thread chunk height computation
    spawn.worker.ts    # Off-thread spawn point generation
  objects/
    GameObject.tsx     # GLTF model loader with colliders + animations
    spawning/
      ObjectPool.tsx   # Spawn management, frustum culling, pooling
      collectDescriptors.ts # Aggregates SpawnDescriptors from regions/biomes
      generateSpawnPoints.ts # Worker client for spawn generation
      SpawnSpatialHash.ts # Grid-based spatial hash for spacing
      types.ts         # SpawnDescriptor, SpawnPoint, SpawnedObjectProps
    colliders/         # Physics collider components
  player/
    Player.tsx         # First-person controller + physics
    useInput.tsx       # Keyboard input
  utils/
    voronoi/           # Web worker Voronoi system (voronoi.ts queues, .worker.ts computes)
    noise/_noise.ts    # Perlin/Simplex FBM wrapper (TerrainNoiseParams)
    math/_math.ts      # seedRand, lerp, smoothstep, randRange
    material/          # Texture loading, biome material composition
    city/_city.ts      # City grid generation + block placement
    task-queue/        # Async task queue
  canvas/              # Three.js canvas + physics world setup
  context/             # GameContext (player position, terrain loading state)
  menus/               # Pause menu, overlay, command palette
```

### Terrain Pipeline

1. Player position → `computeDesiredChunks()` (quadtree LOD)
2. New chunks queued → `BuildChunk()` async generator
3. Per-vertex: worker uses `WorldConfig` → voronoi → biome height + blend
4. Geometry buffers written, normals computed, skirt vertices set
5. Chunk made visible via atomic LOD swap system

### Key Patterns

- **No dimension abstraction** — the world is defined directly by `WORLD_REGIONS` in `src/world/world.ts`. Components import what they need directly instead of receiving a `dimension` prop.
- **Utility namespaces**: `_noise.terrain()`, `_math.seedRand()`, `_material.loadTextures()`, `voronoi.create()`
- **Biome shaders**: fragment shaders branch on `vBiomeId` varying; vertex shader is shared
- **Geometry pooling**: `acquireGeometry()`/`releaseGeometry()` recycle BufferGeometry per LOD level
- **Vertex budget**: terrain builds multiple small chunks per frame (LOD3-5) up to a budget limit
- **Voronoi caching**: grid results, Delaunay triangulations, and wall boundary data are cached with spatial eviction
- **WorldConfig**: serializable config sent to workers (`buildWorldConfig(regions)`) containing region/biome data, noise params, and city config

## Adding Content

### New Biome

1. Create `src/biomes/<name>/`
2. Define biome object implementing `Biome` interface (`id`, `name`, `joinable`, `blendable`, `getVertexData`, `getMaterial`)
3. Create `getVertexData.ts` — receives `VertexData`, modifies height, returns it
4. Create `getMaterial.ts` — returns `{ uniforms, fragmentShader }`
5. Create `shaders/fragment.glsl` — define a `<name>_frag()` function
6. Register in a Region's `biomes[]` array
7. Add biome ID branch to the world's combined fragment shader (`src/world/getMaterial.ts`)
8. Add biome class to the `biomes_in_use` array in `voronoi.ts` worker message handler
9. Add biome noise config to `buildWorldConfig.ts` if the biome uses noise-based height

### New Region

1. Create `src/regions/<Name>Region.ts`
2. Export a `Region` object with `name`, unique `id`, `biomes[]`, optional `getMaterial`
3. Add to `WORLD_REGIONS` in `src/world/world.ts`

### New Spawn/NPC

1. Create component in the relevant biome's `creatures/` directory
2. Use `GameObject` for GLTF loading + colliders
3. Add a `SpawnDescriptor` to the biome's `spawnables` array
4. Place GLTF model in `public/models/`

## Performance Notes

- **Voronoi batch size** (`MAX_BATCH_SIZE` in `voronoi.ts`) is 10. Increasing it causes frame drops because the worker blocks too long on large batches.
- **Terrain vertex budget** (`MAX_VERTS_PER_FRAME` in `Terrain.tsx`) is 2500. This lets many small LOD chunks build per frame while capping main-thread work.
- Voronoi worker uses O(n) nearest-entry scans instead of sorting. Grid arrays are never mutated by lookups.
- Delaunay triangulations are cached via `WeakMap` keyed by grid array identity.
- Cache eviction in the worker only runs on cache misses, not every query.
- `getDistanceToWall` uses inline segment-distance math (no THREE object allocations).
- `BuildChunk` reads position buffers directly as Float32Array (no Vector3 per vertex).

## UI / Overlay Styling

All overlays, menus, and HUD elements should follow the established style set by the stats overlay (`Overlay.tsx`) and command palette (`CommandPalette.tsx`):

- **Font**: `'Kode Mono', 'Courier New', Courier, monospace` — 12px, line-height 1.5
- **Color scheme**: green-on-black terminal aesthetic — text `#0f0`, backgrounds `rgba(0,0,0,0.6)` to `rgba(0,0,0,0.85)`
- **Containers**: `border-radius: 4px`, `padding: 8px 12px`, `pointer-events: none` for passive overlays
- **Selection/hover highlights**: `rgba(0,255,0,0.15)` background
- **Inputs**: transparent background, no border except `1px solid #0f0` bottom, inherit font
- **Graphs/sub-elements**: `border-radius: 2px`, `rgba(0,0,0,0.4)` background
- **Positioning**: `position: fixed`, use `z-index: 1000` for HUD overlays, `z-index: 9999` for modal overlays with backdrop
- **Inline styles preferred** — overlays use JS style objects (not CSS modules) since they're built imperatively or need dynamic values. CSS modules are used for the pause menu.

## Conventions

- PascalCase for components/types, camelCase for utilities/functions
- SCREAMING_SNAKE_CASE for constants and enums
- Feature-based directory structure — co-locate assets (shaders, textures) with their biome/feature
- Prefer editing existing files over creating new ones
- Keep biome implementations self-contained; don't add cross-biome dependencies
- Interfaces live in the nearest `types.ts` (world-level types in `src/world/types.ts`)
