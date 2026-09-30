# Generation workers and the height pipeline

This folder holds several features that share one pipeline, and a folder can only have one README,
so this README is split into sections: **Pipeline**, **Module map**, **Rivers**, **Freeways and
city roads**, **Flatten pads**. Lakes and bridges also have code here, but each has its own
feature folder elsewhere, so they are documented there:
[Water](../../world/water/README.md) (`lakes.ts`) and
[Bridges](../../objects/dressing/bridges/README.md) (`bridges/`).

## How it works

### Pipeline

[`vertexCompute.ts`](vertexCompute.ts) is the ONLY height implementation. `computeVertexData(x, z)`
returns a `VertexResult` (see [`types.ts`](types.ts)): the height plus everything the shader,
spawns and dressing need (blend fields, road/river distances, water height). The terrain, spawn,
foliage and dressing workers, the main thread ([`world/terrain/vertexData.ts`](../../world/terrain/vertexData.ts))
and the server all run the same code, after calling `initCompute(domainConfig)`. The code is
Three-free. **Callers outside this folder import from `vertexCompute.ts` only**: it re-exports the
public API of every module below.

The per-vertex steps, in execution order — what each reads, writes and overrides, the far/raw
variants, the uploaded attributes and the shader's mix order — are traced in
[VERTEX_JOURNEY.md](../../world/VERTEX_JOURNEY.md) (the `// Step N` comments in `computeVertexData`
follow it).

Every function shares scratch buffers, and some steps recurse into the pipeline. Copy anything
you keep from a result. The modules import each other in cycles (a river surface samples the
terrain, the terrain samples the rivers): values cross modules only inside functions, never in a
top-level initializer (`bridges/constants.ts` is a leaf for exactly that reason).

### Module map

| module | what it owns |
|---|---|
| [`vertexCompute.ts`](vertexCompute.ts) | `initCompute`, `computeVertexData` / `computeVertexDataFar` (far LODs: no pads, runs or rivers), `blendedTerrainAt` / `terrainOnlyAt`, `freewayDistanceAt`, and the public re-exports |
| [`types.ts`](types.ts) | `DomainConfig`, `VertexResult`, `Zone`, `Wall`, `VoronoiCell`, `BiomeContext` |
| [`computeConfig.ts`](computeConfig.ts) | The live `domainConfig` binding every module reads |
| [`noise.ts`](noise.ts) | Seeded simplex/perlin noise, `terrainNoise` (FBM), `biomeNoiseHeight`, the road warp `warp` / `unwarp` |
| [`voronoi.ts`](voronoi.ts) | The region grid (3000u) and biome grid (500u): jittered sites, per-cell rolls, the 5×5 window, Delaunay, zone walls (`getZoneWalls`, `wallsOfBiome`), `getBiomeContext` |
| [`zoneBlend.ts`](zoneBlend.ts) | Zones, `accumulateWallFields` (the wall pass), `combineZoneWeights`, the biome slots the shader reads (`biomeSlotsOf`, `combineSlotWeights`) |
| [`cellCache.ts`](cellCache.ts) | `CellCache` (nested numeric maps) and `dropOldestHalf`, the eviction rule for every hot cache |
| [`places.ts`](places.ts) | Place queries (`getPlaceInfo`, `findBiomeCell`, cell sites), used by the sky, the address bar and fast travel. Not called per vertex |
| [`lakes.ts`](lakes.ts) | Lake level and shore lift. See [Water](../../world/water/README.md) |
| [`flattenPads.ts`](flattenPads.ts) | Flatten pads (below) and `computeVertexDataRaw` |
| [`rivers/`](rivers) | [`riverNetwork.ts`](rivers/riverNetwork.ts) (the river grid, `getRiverSegments`), [`riverRoadLayer.ts`](rivers/riverRoadLayer.ts) (where roads win), [`riverField.ts`](rivers/riverField.ts) (the per-vertex field). See Rivers below |
| [`roads/`](roads) | [`freewayNetwork.ts`](roads/freewayNetwork.ts) (`getNetwork`, `networkOf`), [`freewayGrade.ts`](roads/freewayGrade.ts), [`cityTerrain.ts`](roads/cityTerrain.ts), [`cityFeatures.ts`](roads/cityFeatures.ts), [`roadFragments.ts`](roads/roadFragments.ts). See Freeways below |
| [`bridges/`](bridges) | Bridge decks: [`freewayBridges.ts`](bridges/freewayBridges.ts) is the entry (`getFreewayBridges`); road paths, wet items, rules, deck builder, deck geometry, drawn slab, crossings, mouths, the census (`severed.ts`) and the ground cut (`deckGround.ts`) each have a module. See [Bridges](../../objects/dressing/bridges/README.md) |
| [`densityGrid.ts`](densityGrid.ts) | The one density-grid roll + placement filters, shared by the spawn worker, the flatten pads and dressing (they must agree to the bit) |
| [`densityPoints.ts`](densityPoints.ts) | `generateDensityPoints`: one chunk's stateless density-placed points (the `densityPoints` dressing enumerator, the server's lamp colliders) and `slopeDegreesAt` |
| [`workerClient.ts`](workerClient.ts) | `createWorkerClient`: lazy boot, INIT handshake, id-matched requests, `reset()` |
| `*.worker.ts` | `terrain` (chunk buffers), `spawn` (actor points), `foliage` (grass instances), `dressing` (enumerators, padded samples, place info). Each file's header lists its messages |

The typed clients are [`world/terrain/TerrainRenderer.tsx`](../../world/terrain/TerrainRenderer.tsx) (terrain),
[`objects/actors/spawning/spawnWorker.ts`](../../objects/actors/spawning/spawnWorker.ts),
[`objects/foliage/foliageWorker.ts`](../../objects/foliage/foliageWorker.ts) and
[`objects/dressing/dressingWorker.ts`](../../objects/dressing/dressingWorker.ts). The committed
`Region[]` becomes the `DomainConfig` in [`world/domains/buildDomainConfig.ts`](../../world/domains/buildDomainConfig.ts).

### Rivers

Rivers are not tied to biomes. They are the edges of a THIRD voronoi grid (`RIVER_GRID_SIZE`
2800u, shifted by `RIVER_GRID_SHIFT`), so where they run depends only on position. They are
documented here and not in their own README because all of their code lives in this folder and
is interleaved with the pipeline: the river surface samples the terrain, and the terrain carves
the rivers.
- **Network** ([`rivers/riverNetwork.ts`](rivers/riverNetwork.ts), `getRiverSegments`): each edge
  keeps a river with probability `RIVER_KEEP_PER_PROBABILITY × riverProbability` of the region
  under it. Edges are cut into 50u pieces. A piece is not built deep in water, near a
  `prohibitRivers` biome, or on mountainous or steep ground. Short gaps between river and water
  are filled back in. An end becomes a pond or a fizzle. Width is set per junction and grows
  toward the ocean, up to `RIVER_WIDTH_MAX`.
- **Road layer** ([`rivers/riverRoadLayer.ts`](rivers/riverRoadLayer.ts), `riverPieceSuppressed`
  and the `RIVER_ROAD_*` constants): where a road runs ALONG a river for longer than a deck should
  span, or meets it where no deck may carry it, the river is not built there and ends bluntly.
  Crossings stay and get bridges.
- **Field** ([`rivers/riverField.ts`](rivers/riverField.ts), `riverFieldAt`): per vertex, the
  distance in "factor-1" units (real distance ÷ the local width factor, so every consumer compares
  against the `river` config in `world/defaults.ts`), the width factor and the water surface.
  Rivers combine by a smooth minimum, which rounds confluences, and are measured from a meandered
  point, which makes channels wind. `riverQuayAt` / `riverStraightNear` give the un-meandered
  distance that the city's quay roads follow.
- The channel carve itself is step 4 of `computeVertexData`. Every placement filter keeps objects
  off rivers through `riverKeepOff()` (`densityGrid.ts`).

### Freeways and city roads

- **Inter-city freeways** ([`roads/freewayNetwork.ts`](roads/freewayNetwork.ts), `getNetwork`):
  built once per biome cell over a wide window of biome walls. Adjacent city cells are merged into
  one city, and cities up to `FREEWAY_LINK_CELLS` apart are joined by the shortest path over walls
  that have no city, water or `prohibitRoads` biome on either side. Short gap hops link lobes of
  the same city. The result is a list of `FreewayRun` polylines. `nearestFreewayRun` measures a
  point against them. Step 5 of the pipeline grades ([`roads/freewayGrade.ts`](roads/freewayGrade.ts)),
  dips and paints them.
- **City terrain** ([`roads/cityTerrain.ts`](roads/cityTerrain.ts), `getCityTerrain`): staggered,
  rotated districts; a square block grid inside each district, with triangle and roundabout
  super-cells; wiggly arterials on district boundaries; the belt freeway centered on the city's
  biome wall; quay roads along rivers. It outputs one road-distance field (in normalized street
  units) and a plateau elevation per vertex. The shader bands and the spawn filters
  (`roadDistanceRange`) read that same field.
- **City dressing enumerators** ([`roads/cityFeatures.ts`](roads/cityFeatures.ts)): road markers,
  traffic lights, freeway-side poles, city-light sites and run markers. They are deterministic, and
  each point belongs to the chunk that contains it, so no point is duplicated. The dressing worker
  serves them.
- **Road fragments** ([`roads/roadFragments.ts`](roads/roadFragments.ts)): a piece of road a river
  has cut off from every other road, too small for anything to stand on, is drawn as the river's
  bank.

### Flatten pads

An actor placed with `flattenGround: true` (buildings) gets a flat pad in the terrain under every
instance. The pad is flat within `flattenRadius` (default footprint × 0.45) and blends back over
`flattenSkirt` (default × 0.35). Placement must be fully deterministic for this to work.
[`flattenPads.ts`](flattenPads.ts) rolls the spawn worker's own density seeds per 128u tile against
the RAW, pad-free height, applies spacing in several stateless rounds, and exposes the result
through `getFlattenPoints`. The spawn worker places those actors FROM that function, and
`applyFlattenPads` builds the terrain from it, so every instance stands on its pad. Pads are
skipped on far visual LODs. `computeVertexDataRaw` is the pad-free height. Pads dig into slopes as
well as fill them, so the raw height is not a lower bound on the real ground. (A flatten actor's
`slopeRange` is not applied: the flatten engine does not test slope.)

## How to use/add

**Add a biome with plain noise height:** nothing here. Set `noise` in the biome's `spec.ts`.

**Add a biome with bespoke height code** (like the city):
1. Add its id to `src/world/constants.ts`. Workers cannot import biome folders.
2. In `zoneBiomeHeight` ([`vertexCompute.ts`](vertexCompute.ts)), add a branch
   `if (zone.biome.id === MY_BIOME_ID) return myHeight(x, z) * presence;`. Put the height code in
   its own module here and import it.
3. Add a case to [`blend.test.ts`](blend.test.ts) if the biome's edge must match its neighbors.

**Add a water biome:** `water: { depth }` in the biome spec. See [Water](../../world/water/README.md).

**Give an actor flatten pads:** place it in a biome spec's `actors` list with `flattenGround: true`
(optionally `flattenRadius`, `flattenSkirt`), plus the usual `density`, `footprint`, `biomeIds` and
`roadDistanceRange`. The server's config derives its pads from the same specs
(`buildDomainConfigFromSpecs` in `src/world/domains/domainConfig.ts`); nothing else to list.

**Add a dressing enumerator** (structured placement such as lattices or intersections):
1. Write `getMyPoints(minX, minZ, maxX, maxZ, ...)` in a module here (city ones go in
   [`roads/cityFeatures.ts`](roads/cityFeatures.ts)). Assign each point to the chunk containing its
   world position and validate points through `computeVertexData`. Re-export it from
   [`vertexCompute.ts`](vertexCompute.ts).
2. Add ONE entry to `DRESSING_ENUMERATORS` in `src/objects/dressing/enumerators.ts`: the dressing
   worker and `enumerateDressing` (`objects/dressing/dressingWorker.ts`) reach it by name, and the
   server's obstacle colliders run it too when its feature has a collider spec.
3. Add determinism and chunk-split cases to [`roads/cityFeatures.test.ts`](roads/cityFeatures.test.ts).

**Tuning** (these knobs change the world for everyone, so every address moves):
- River size: `river` in `src/world/defaults.ts` (`halfWidth`, `depth`, `bank`). River density per
  region: `riverProbability` in the region's `spec.ts`.
- City layout: `cityConfig` in `src/world/defaults.ts` (`gridSize`, `roadWidth`, `freewayWidth`,
  `districtSize`, `triangleChance`, `roundaboutChance`). `roadWidth` must match the bands in the
  city biome's fragment shader.
- Freeway reach: `FREEWAY_LINK_CELLS` in [`roads/freewayNetwork.ts`](roads/freewayNetwork.ts).
- Tests: `$env:CI="true"; npm test -- --watchAll=false src/utils/workers`.
