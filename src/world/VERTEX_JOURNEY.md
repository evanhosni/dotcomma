# The vertex journey

This page follows one terrain vertex from the chunk request to the final pixel. Heights and blend
fields are computed on the CPU by ONE function, `computeVertexData` in
[`utils/workers/vertexCompute.ts`](../utils/workers/vertexCompute.ts). The material is mixed per
pixel on the GPU from what that function returns. Order matters in both halves: a later step
overwrites what an earlier one wrote, so the table in [Summary](#summary) is the short answer to
"what wins".

Everything below is in execution order. File links are relative to this folder.

## 1. Entry: who asks, and which variant runs

[`terrain/TerrainRenderer.tsx`](terrain/TerrainRenderer.tsx) builds a chunk by posting `BUILD_CHUNK` (through [`terrain/buildRequests.ts`](terrain/buildRequests.ts))
to [`utils/workers/terrain.worker.ts`](../utils/workers/terrain.worker.ts) with the chunk's LOD flags
from [`terrain/lodConfig.ts`](terrain/lodConfig.ts). The worker walks the `(segments + 1)²` grid
(local x/z are `Math.fround`ed so heights match the float32 positions) and calls one of three
variants per vertex:

| variant | used by | what it skips |
|---|---|---|
| `computeVertexData` | LOD1–2 (they have colliders), the spawn, foliage and dressing workers, the main thread's padded lookups ([`terrain/vertexData.ts`](terrain/vertexData.ts) `getVertexData`, the dressing worker's `getVertexSample`), the server's heightfields and bodies ([`server/src/game/physics/terrain.ts`](../../server/src/game/physics/terrain.ts), `groundBody.ts`, `freeBody.ts`) | nothing |
| `computeVertexDataFar(x, z, rivers)` | visual-only LODs (`!hasCollider`: LOD3–4) | flatten pads, bridge decks, road fragments, block islands, the cave mouth bulge and the spring water, the inter-city freeway RUNS (the belt stays); with `rivers = false` (`carvesRivers: false`, LOD4) also the river field: no channel, river water, bed paint or quay |
| `computeVertexDataRaw` ([`flattenPads.ts`](../utils/workers/flattenPads.ts)) | pad candidates, the road-fragment and block-island flood fills, sparse scans, the splash and bubble emitters, the Player's water probe (`getVertexSample` raw, on the dressing worker) | flatten pads, bridge decks, road fragments, block islands, the mouth bulge, the spring water |

`computeVertexDataFar` is `computeVertexDataRaw` with two flags set (`farVisual`, `farDry`), so
every "raw" skip below applies to it too. Before the loop the worker calls
`setDeckCutSpacing(chunkSize / segments)`, so step 11 cuts as far beside a deck as this chunk's
triangles reach; everyone else keeps LOD1's spacing.

## 2. The CPU pipeline, step by step

The step numbers match the `// Step N` comments in `computeVertexData`. "Reads / writes / overrides"
name what each step consumes, what it produces, and what earlier result it replaces.

### Step 0: the decks and the cave mouths in reach

- **Code:** `decksAround` ([`bridges/deckGround.ts`](../utils/workers/bridges/deckGround.ts)) and
  `mouthsNear` ([`underground/systems.ts`](../utils/workers/underground/systems.ts)).
- **Reads:** the vertex's 256u cell of decks (cached per cell; filling the cache enumerates the
  bridges there, `getFreewayBridgesNear`, which evaluates the terrain many times) and its 128u tile of
  cave mouths (cached per tile, the last tile remembered; a cold tile generates the caves in reach,
  which evaluates the terrain too).
- **Writes:** `cellDecks`, used in step 11; `cellMouths`, used in step 10; `mouthsKnown`, which also gates step 14's spring water.
- **Skipped:** on the raw and far paths, and while bridges are being enumerated (`decksKnown` false);
  the mouths also while a cave or sewer is being generated (`tunnelsGenerating()`), so no mouth depends
  on its own bulge and no seed moves.
- It runs FIRST because enumerating decks or generating a cave clobbers every scratch buffer the later
  steps fill.

### Step 1: the road warp

- **Code:** `warp` ([`noise.ts`](../utils/workers/noise.ts)).
- **Reads:** world `(x, z)`.
- **Writes:** the warped point `(cvx, cvz)`. Every grid, wall, road and river is laid out in warped
  space. The noise heights further down are still sampled at world `(x, z)`.

### Steps 2–3: grids, then the work that clobbers the scratch

1. **The biome cell and its zone.** `getBiomeContext` ([`voronoi.ts`](../utils/workers/voronoi.ts))
   returns the 5×5 biome-grid window, the nearest cell's ZONE, and the zone walls (`getZoneWalls`,
   the Delaunay duals of the window; each wall is listed twice, endpoint-swapped). The region is NOT
   looked up per vertex. Each biome cell took its region from the region-grid cell nearest the
   cell's SITE (`zoneOfRawSite`: `getRegionGrid` → `nearestCell`, then a seeded biome roll from that
   region's list). A zone is a (region, biome) pair.
2. **The river field.** Off the city, the nearest city wall is measured first (pure geometry). Then
   `riverFieldAt` ([`rivers/riverField.ts`](../utils/workers/rivers/riverField.ts))
   writes `riverSample`: distance in factor-1 units, the width factor, the water surface, the FLOW
   (each piece's downhill direction × its strength, blended across the pieces by nearness — step 8
   carries it to the water mesh), and the centerline's signed distance to a water wall and the lake
   level there (step 8's merge). It is measured from a meandered point, and it smooth-mins confluences.
   The factor and surface come from each run's PLAINLY nearest piece, weighted across runs by the
   smooth-min weights. Building a cell's piece list (first query in a cell) evaluates the terrain at
   every piece end (`riverPieceEndSurface`, [`rivers/riverSurface.ts`](../utils/workers/rivers/riverSurface.ts)):
   a ROCK stretch (`isRockBiome`, a domed biome) is built whatever its slope, a peak along it is a
   level POOL (`riverPoolWiden`), a GORGE's ends run straight and downhill between its two waters, and
   the surface is capped under every road that shadows the river (`roadCrossingCap`, the road walked
   both ways: 8u to 600u, 12u past the landing). On the bank it also writes the BED LIMIT (`bedLimit`):
   how far out the bed reaches before its bank first gets steep on rock, interpolated from per-station
   marches ([`rivers/riverBedLimit.ts`](../utils/workers/rivers/riverBedLimit.ts); each march evaluates
   the terrain). In a city and within 6u of its wall the limit is found past the reach too, as far as the
   quay rule can still paint the bed (`RIVER_BED_LIMIT_PAST`). Far-dry vertices call `noRiverSample`.
3. **The nearest freeway, off the city only.** `nearestFreewayRun` finds the inter-city runs
   ([`roads/freewayNetwork.ts`](../utils/workers/roads/freewayNetwork.ts)); it is skipped in a water
   zone and on far LODs. `findNearestCityWall` finds the belt seen from outside. Together they give
   `roadReal`, a smooth minimum of the two. Near a river the belt's distance is the city's own measure
   (`drownedBeltDistance`): off a wall the river drowns it is pushed away as on the city's side.
4. **The road grade**, only where step 9 will use it (`roadReal < freewayWidth + FREEWAY_GRADE_RAMP`,
   or out to its widened approach shoulder in a cell with decks and while decks are enumerated).
   `freewayGradeAt` ([`roads/freewayGrade.ts`](../utils/workers/roads/freewayGrade.ts)) samples the
   centerline terrain every 8u with that point's OWN wall pass (`terrainOnlyAt`), smooths it along
   runs, and blends it over the nearby segments.

Items 2–4 must run before step 4, because each of them runs other points' wall passes through the
same scratch buffers.

### Step 4: the wall pass

`accumulateWallFields` ([`zoneBlend.ts`](../utils/workers/zoneBlend.ts)) runs one loop over the zone walls:
- **Height indicator per zone:** `smoothstep(-h_b, +h_a, s)` across each wall, from each side's
  `heightHalf`. The own zone takes the MIN over its walls, foreign zones the MAX. Within one own
  `heightHalf` of its edge, the own MIN is floored by the foreign MAX read at `d − 2δ` (the edge
  floor), so on the edge it equals what the vertex across computes and a junction has no seam.
- **`zoneMinDist`:** each zone's nearest wall.
- **`ownWallDistance` / `ownWallAlong`:** the own zone's nearest wall, and a phase along it (the
  belt's dash phase).
- **`biomeSdf`:** the material signed distance per biome SLOT, scaled by the wall's
  `materialHalf`, which is the SMALLER side's feather.
- **`biomePresence`:** per slot, the distance inside the biome's own boundary in its blend widths.

### Step 5: heights per zone, combined by crispness

- **Precedence.** `combineZoneWeights` turns the indicators into weights that sum to 1. It works in
  tiers of equal `heightHalf`, crispest first: each tier claims its share, and softer tiers split
  what is left. This is not plain normalization.
- **Per zone** (weight ≥ `ZONE_WEIGHT_EPS`), `height += w × (region base noise + zoneBiomeHeight)`.
  The base noise is `terrainNoise(zone.baseNoise, x, z)`, the zone's REGION base, and it is sampled
  at world `(x, z)`.
- **What `zoneBiomeHeight` returns:**
  - **A noise biome:** `biomeNoiseHeight × presence`. Presence is `sstep01(zoneMinDist /
    heightPresenceWidth)` for the own zone and 0 for foreign zones. A noise config with a `dome` (the
    mountain) adds a massif that rises with the square of the vertex's depth, `domeDepthAt`
    ([`zoneBlend.ts`](../utils/workers/zoneBlend.ts)), and its `detail` layers (bulges and bumps) are
    added linearly at every depth. The depth is the zone's site depths (each site's distance to its
    zone's nearest foreign wall, cached per cell), interpolated by a compact kernel over the sites
    nearby, and smooth-min'ed under `zoneMinDist` so it is 0 on the edge. Joined cells have no wall
    between them, so a joined group is one dome, highest where it is deepest. The dome also fades the
    noise in from `noiseFloor`.
  - **A water biome (lake):** a bowl defined relative to the blended lake level (`lakeLevelAt`,
    [`lakes.ts`](../utils/workers/lakes.ts)). It is `SHORE_RISE` above the level at the wall and
    `depth` below it at full presence, minus the base noise, so the base cancels.
  - **The city, own zone:** `getCityTerrain` ([`roads/cityTerrain.ts`](../utils/workers/roads/cityTerrain.ts)),
    after `riverQuayAt` fills the straight river field. The city branch runs in this order (the
    order is part of the output: city cells are cached by first query):
    1. Pick the district ([`roads/cityDistricts.ts`](../utils/workers/roads/cityDistricts.ts)) and rotate into its local frame.
    2. Look up the block-grid cell and its 3×3 labels (`readNeighborLabels`). A cell's label comes from
       its survey (`cellSurvey` in [`roads/cityCells.ts`](../utils/workers/roads/cityCells.ts), cached per cell): a REMNANT, one the edge roads (belt, arterials, quays)
       leave too little of, takes a full neighbor's label, so its land joins that block.
    3. Collect the road constraints: merged cell-boundary segments (`addBoundaryStreets`, not inside
       a roundabout's ring); the shape feature (`addShapeFeature`: a triangle super-cell's diagonal, a
       roundabout ring); the arterial field (`addArterialConstraint`: district boundaries, recovering
       past 12.2); the belt (`addBeltConstraint` → `findWaterfrontBelt`, [`roads/cityWaterfront.ts`](../utils/workers/roads/cityWaterfront.ts): the wall, or the waterfront
       where a wall is drowned); the quay road beside a river (`addQuayConstraint`).
    4. Interpolate the plateau heights bilinearly (`plateauElevation`).
    5. Ramp toward the mid-plateau freeway grade near arterials and the belt.
    6. Give a roundabout island its own plateau.
    7. Apply the pairwise chamfer (`chamferedRoadDistance`), giving the road distance.
    8. On the wall the road field is at least the belt's (it falls off inward at 4 per unit), then on
       the river side of the quay, lerp the road field to the quay's own field.
    9. Dip the curb (`curbHeight` under `roadWidth`), returned as `curbDip` too: step 6 applies a
       shore lift under it.
    10. Compute the lane-paint distances, blanked in junction zones (`measureLanePaint`).

    The result is kept as `ownCityTerrain`.
  - **The city, foreign zone:** `maxBlockElevation / 2`, the belt grade. A crisp zone has presence 1
    everywhere.
- **Paint distances in the city.** Right after the loop, a city vertex takes `distanceToRoadCenter`,
  `distanceToFreewayCenter` and `freewayAlong` from `getCityTerrain`. A run merging into the belt
  blanks the lane paint. `riverBedDistance` is capped by the quay's straight bank edge
  (`QUAY_BED_INSET` = `RIVER_BED_FULL_INSET`), never below where the bed is whole; just outside the
  city's wall the same rule hands over to the river's own distance within 6u.
- **Overrides:** nothing yet. This step is the terrain before water, roads and pads.

### Step 6: the lake and the shore lift

- **The lake.** `lakeSurface` returns the lake level where a water zone has weight, or NaN. It also
  stores the shore state (level, distance to the nearest water wall).
- **The shore lift.** `shoreLift` lifts land within 160u of a water wall onto `level + SHORE_RISE`,
  fading out over 250u, and with the level kernel's weight where it nears the end of its support.
  Only land lower than that is raised. A city vertex's curb dip is applied under the lift, as the
  belt's outer half dips under its lifted grade. In a water zone where a neighbor still
  has weight, the blend is instead held at least at the bowl's own height (`bowlFloor`), which on the
  wall is that same shore height, so the two sides meet.
- **Overrides:** the step-5 height.

### Step 7: the bed limit cap

`capRiverBed` ([`rivers/riverBedLimit.ts`](../utils/workers/rivers/riverBedLimit.ts); only a ROCK bank
ends the bed, see GPU step 3.4): off the city, wherever `riverBedDistance` is inside the reach, past
step 2's `bedLimit` it reads as out of reach, fading over the room the limit leaves inward of it and
ending AT the limit (never past it), so the bed ends at its first steep bank and never resumes beyond.
Not in a city (its ground past the edge roads is the bank, and its pavement keeps the bed off through
the shader's pavement mask), and just outside the wall the cap comes in over `BELT_FIELD_HANDOFF`, so
the paint does not step across it.

### Step 8: the river channel, its flow, and the merge beside a lake

1. **The channel** (`carveRiverChannel`, [`rivers/riverChannel.ts`](../utils/workers/rivers/riverChannel.ts)), where `distanceToRiver < halfWidth + bank`. Its
   surface is first held up to a lake's level by the weight of crisp land there
   (`riverSurfaceBesideCrispShore`): the city draws no lake on its side of the wall. The
   channel is FORCED, not min'ed:
   - inside the half-width, a parabola from `surface − depth×√factor` up to the rim
     (`surface + SHORE_RISE`);
   - out to the bank's edge, a blend from the rim back into the terrain (low ground is held at the
     rim across the water band).
   The water height becomes the river surface inside the water band, or the max with a lake.
   - **At a mouth** (`riverMouthShare`, [`lakes.ts`](../utils/workers/lakes.ts)): where the ground
     before the carve lies under the lake drawn there, the carve only deepens it (no rim, no held
     bank), the river surface comes down to the lake level, and `riverBedDistance` is pushed out of
     reach. The share ramps to 0 at the shore height (`level + SHORE_RISE`), so dry land is carved as
     before.
2. **The flow.** `waterFlowX/Z` = the river's flow from step 2, fading from the water band to the
   reach and stilled over a mouth, so an edge triangle never interpolates full flow to none within one
   quad. 0 on a lake.
3. **Beside a lake** (`riverLakeMerge`, [`lakes.ts`](../utils/workers/lakes.ts)), off the city and
   10–40u past any freeway's half-width and the city's own wall: where the river's water band comes
   within `40 + min(band,120)/2` of a water wall (fading over 80u more; `riverSample.shore`, the
   centerline's signed wall distance), the land BETWEEN the two and the lake's beach there sink to the
   river channel's floor; the water there is the lake's level (in the band the river's surface eased
   onto it by the same share) and `riverBedDistance` reads as the whole bed. The far bank is untouched.
4. **The channel mask.** `channel` (0 in the channel, 1 on open ground) stops the city's lane paint
   over the riverbed.

- **Overrides:** the step-6 height (the carve and the merge). The city is carved AFTER its plateau and
  curb dip, and BEFORE pads.

### Step 9: freeways off the city

`gradeOffCityFreeway` ([`roads/offCityFreeway.ts`](../utils/workers/roads/offCityFreeway.ts)) runs only when `city === null`. It covers the inter-city runs and the belt's
OUTER half, and writes its results to `offCityRoad`.

- **Reads:** `nearestRun` and `nearestCityWall` from step 3, the river field, and for the belt beside
  a river `riverQuayAt` and `wallDrownedAt`.
- **The river yield.** The road gives way to a river: the belt across the river's whole footprint,
  a run only near the water (`runRiverYield`), blended by `runShare`. This gives `roadChannel` and
  `laneEndGap`.
- **The road field** (written out to 70u): the normalized distance `roadReal × roadWidth /
  freewayWidth`. It is pushed past the pavement where the road yields to the river (the deck covers
  it), with a smooth max. The belt follows the city's quay rule. It only LOWERS
  `distanceToRoadCenter`.
- **The grade** (within `freewayWidth + 10`): `height += (grade − curb dip − height) × mask`. The
  mask is 0 in the river channel, so the grade overrides the step-8 banks but never fills the
  channel. The grade is step 3's `roadGrade`, or `blendedTerrainAt` at the centerline when none was
  found. The BELT's outer half beside a river is instead what the city's inner half is at the wall.
- **Lane paint:** `distanceToFreewayCenter` / `freewayAlong`, except in the channel, a merge mouth,
  or on a drowned belt wall.
- **The approach** (`approachDelta`, `VertexResult.approachHeight`): the same grade and curb with no
  river yield, flat `APPROACH_WIDEN` past the half-width and a `APPROACH_SHOULDER` shoulder; not in a
  lake zone. Step 11 lays it in front of landed ends, and the landings sit on it. Where it lies under
  the river's rim, `approachRimLift` holds it up, applied only inward of the end.

### Step 10: the cave mouth bulge, then the flatten pads

- **The bulge** (`applyMouthBulge`, [`underground/mouthBulge.ts`](../utils/workers/underground/mouthBulge.ts)):
  the one height step the tunnels make, around every mouth step 0 found. A cosine MOUND (up to 0.9
  opening radii, over 9 radii; off over the floor's strip while the ground is still at the floor,
  re-lifting as the ground rises 0.5–3u above it), a
  HOOD over the section (rising from the opening to the tube's crown + 0.3 radii of rock, shouldered
  off beside it and trailing off past the inner end), a point taking the LARGEST lift of any mouth in
  reach, and a LEDGE in front (the ground levelled 0.08u under the mouth's floor over 1.5 radii out and
  1.1 to each side), which overrides any lift. Zero where water stands over the ground and faded to zero
  within 4 + 8u of a road's and a freeway's paved half-width and of a river's keep-off, measured from
  the pipeline's own fields (so every worker agrees whether or not a generation filled its caches).
- **The pads** (`applyFlattenPads`, [`flattenPads.ts`](../utils/workers/flattenPads.ts)) run only on
  the padded path, and only in biomes some flatten descriptor targets; a pad still overrides the bulge.
- **Scratch:** before the pads, the sdf and presence are copied into `biomeSdfResult` /
  `biomePresenceResult`. Pad candidates recurse into the raw pipeline and overwrite the scratch.
- **Overrides:** the height, lerped toward each pad's raw ground height in ascending mask order.
  That covers everything before it, including roads and rivers. Placement filters keep pads off
  roads and rivers (`roadDistanceRange`, `riverKeepOff`), so in practice pads only replace natural
  or city relief.

### Step 11: the ground under the decks

- **Code:** `cutGroundUnderDecks` ([`bridges/deckGround.ts`](../utils/workers/bridges/deckGround.ts)),
  run only when step 0 found decks.
- **The approach** (first). Within a landed end's approach (`bridgeApproachAt`, [`bridges/deckMouth.ts`](../utils/workers/bridges/deckMouth.ts): the cut margin +
  16u in front, fading over 16u; inward over the ramp and the margin; 34u past the deck's sides) the
  height takes step 9's `approachDelta`, so the road is flat across at its grade and the bank gives
  way to it, gated off in the channel (`halfWidth` → the water band).
- **The mouth.** In front of a landed cut end the ground lies flush with the slab out to the chunk's cut
  margin, then eases back to the road's own height over 16u (height only). The curb's rise follows the
  field the mouth paints (last item), never a step where the mouth ends.
- **The cut.** Under and beside every drawn slab, the ground is cut to just below it
  (`bridgeTriangleCap`, [`bridges/drawnSlab.ts`](../utils/workers/bridges/drawnSlab.ts)). It stays above any drawn water, or drops the water where the slab is lower.
- **The fill.** Inward of a landed cut end, the ground is filled up to the slab.
- **Paint.** Off the city, the road's paint is removed under the deck.
- **The mouth's paint** (last). `bridgeMouthFieldAt` ([`bridges/deckMouth.ts`](../utils/workers/bridges/deckMouth.ts)):
  between a landed cut end and its road's asphalt the road field becomes asphalt; it only ever LOWERS
  `distanceToRoadCenter`, and not past 14.2.
- **Writes:** `underDeck`.
- **Overrides:** height, road field, freeway field and water height from every step before, pads
  included.

Step 11b follows. A freeway whose road ends at a river with no deck landing within 40u loses its lane
paint `LANE_END_CLEAR` (24u) short of the river end.

### Step 12: road fragments and block islands

- **Fragments** (`inRoadFragment`, [`roads/roadFragments.ts`](../utils/workers/roads/roadFragments.ts)),
  on the padded path near rivers: road land that a river has cut off into a piece of at most about
  5000u², found by a flood fill on an 8u lattice of raw evaluations; not a fragment if a deck lands on
  it. A road vertex whose lattice square has no road corner at all goes too (a speck thinner than the
  lattice), except at a deck's mouth. The road field is raised to 13 (no pavement, no lamp band), the
  lane paint removed, `riverBedDistance` forced into the bed; the HEIGHT is untouched.
- **Block islands** (`blockIslandAt`), on the padded path for city vertices whose 3×3 cells an edge road
  reaches: block land with no point in a building's band, in a piece of at most about 2250u², by a flood
  fill on a 6u lattice. Where the piece's rim is mostly road, the road field becomes `10 − field` (plain
  asphalt) and the HEIGHT the road's own around it; where it is more than twice as much riverbed as road,
  the road field is raised to 13 and `riverBedDistance` forced into the bed. A piece between the two stays.
- **Scratch:** both flood fills write the result buffers, so the vertex's sdf and presence are saved
  and restored around them.

### Step 13: the riverbed's texture distances

- **Code:** `riverbedSdfAt` ([`zoneBlend.ts`](../utils/workers/zoneBlend.ts)), only within the bed's reach + 30u
  (elsewhere the ground's `biomeSdf` is copied).
- **What:** the vertex's `biomeSdf` with the few walls narrower than `RIVER_BED_TEXTURE_HALF` (the city's)
  re-applied at that half — a slot's value is a min or max over its walls, so this IS the pass with every
  half floored. It runs from the restored `biomeSdf`, so nothing clobbers it.

### Step 14: the water's depth, and the spring caves' water

- `waterDepth` = `waterHeight − height` where the water stands over the ground, else 0.
- Where the terrain's own water leaves the point dry and the mouths are known (step 0), `springWaterAt`
  ([`underground/springWater.ts`](../utils/workers/underground/springWater.ts)) reads the spring caves'
  water polygons per 128u tile: inside one, the vertex takes the cave water's level, depth and flow (a
  river's flooded lead at the river's carved depth flowing out of the opening, a pool still, a hall
  sloping between two springs); within `CAVE_WATER_MARGIN` (72u) of one, a DIVE level under the ground
  toward the water's level with a NEGATIVE depth — dry to everything that tests "water over the
  ground", so the sheet dives under the cave's water, never under the mountain over it.
- **Overrides:** `waterHeight`, `waterDepth`, `waterFlowX/Z` (under the mountain only).

### Outputs (`VertexResult`, [`types.ts`](../utils/workers/types.ts))

| field | meaning |
|---|---|
| `height` | final height, after step 12 |
| `waterHeight` | the water surface (lake, river or a spring cave's water under the mountain), or NaN |
| `waterDepth` | how deep the water sheet draws it: > 0 drawn, 0 dry, < 0 dry beside a cave's water (the sheet dives under that water) |
| `waterFlowX`, `waterFlowZ` | the water's flow: downhill along a river scaled by its grade, 0 on a lake and over a mouth, a spring cave's own under the mountain |
| `biomeSdf`, `biomePresence` | per biome slot, from the wall pass (their OWN result buffers on the padded path) |
| `distanceToRoadCenter` | normalized street units; 99999 off-road |
| `distanceToFreewayCenter`, `freewayAlong` | real units and dash phase, for lane paint |
| `riverBedDistance` | the bed paint distance, in factor-1 units |
| `distanceToRiverCenter` | the river distance, in factor-1 units |
| `underDeck` | the deck footprint (1 under a deck, fading beside it) |
| `approachHeight` | the height with step 9's approach delta (what a deck's landing sits on) |
| `riverbedSdf` | per biome slot, the riverbed texture's distances (`riverbedSdfAt`: `biomeSdf` with every wall's half floored at `RIVER_BED_TEXTURE_HALF`); the ground's copy away from any bed |
| `biomeId`, `regionId`, `blend`, `distanceToBiomeBoundaryCenter` | the own zone, its height weight, and its nearest wall |

## 3. What gets uploaded

The terrain worker ships per vertex:

| array | contents |
|---|---|
| `heights` | the height |
| `biomeSdf`, `biomePresence`, `riverbedSdf` | `count × slots`, interleaved |
| `riverBed` | `riverBedDistance` |
| `distRoad` | `distanceToRoadCenter` |
| `distFreeway` | `distanceToFreewayCenter` |
| `freewayAlong` | the lane-paint dash phase |
| `normals` | THREE's `computeVertexNormals`, replicated, main grid only |
| `waterHeights`, `waterDepths`, `waterFlow` | all three, only when some vertex has `waterDepth` > 0 (`waterFlow` is x/z pairs) |
| `snowDepths` | the terrain's own snow depth per vertex (`terrainSnowDepth`, [`snow/snowDrift.ts`](../utils/workers/snow/snowDrift.ts): the one snow rule from the vertex's height, its cover and the slope of its own grid), every LOD; null when no vertex has snow |
| `colliderHeights` | column-major, collider LODs only |

The main thread (`TerrainRenderer.tsx` → [`terrain/chunkGeometry.ts`](terrain/chunkGeometry.ts) `writeTerrainBuffers`) writes these arrays into the geometry. It writes
`heights` into `position.z` (the plane is rotated, so z becomes up), and fills these attributes:

| attribute | from |
|---|---|
| `biomeSdf0`, `biomeSdf1`, `biomePresence0`, `biomePresence1`, `riverbedSdf0`, `riverbedSdf1` | vec4 × 2 each, up to 8 slots (`MAX_BIOME_SLOTS`) |
| `riverBedDistance` | `riverBed` |
| `distanceToRoadCenter` | `distRoad` |
| `distanceToFreewayCenter` | `distFreeway` |
| `freewayAlong` | `freewayAlong` |
| `underwaterDepth` | the water depth (≥ 0) where the ground is under drawn water, else the SNOW depth NEGATIVE (snow never lies under water, and the program has no attribute slot left); the vertex shader splits it into `vUnderwaterDepth` and `vFarSnow` |

Skirt vertices copy their edge vertex's attributes. On LODs with `clampBlendFields` (LOD3–4) the
sdf is clamped to ±1 and presence to 0..1 before upload. Those are the values where the shader's
smoothsteps already saturate, and clamping makes them interpolate as a plain cross-fade: unclamped,
a coarse triangle spanning three zones interpolates every slot below −1, which renders black. LOD1–2
keep the true distances, so a 1u city edge lands exactly. The water goes to the chunk's child water
mesh (`writeWaterBuffers`: wet vertices at the water height with `waterDepth` and `waterFlow`, dry ones
dived under the ground by at least the vertex spacing, a negative depth under the lower of the cave's
water and the ground; [`water/waterMaterial.ts`](water/waterMaterial.ts)). A cave entrance PATCH
(objects/dressing/underground) carries the same attributes plus `entranceRock`, and draws with the
terrain's ENTRANCE variant.

## 4. The GPU material pipeline

The terrain material is generated by `getMaterial` ([`terrain/material.ts`](terrain/material.ts)),
which calls `combineBiomeMaterials` ([`shaders/combineBiomeMaterials.ts`](shaders/combineBiomeMaterials.ts)).

### Vertex shader ([`shaders/vertex.glsl`](shaders/vertex.glsl))

1. The attributes pass through as varyings, unchanged (`underwaterDepth` split into `vUnderwaterDepth` / `vFarSnow`).
2. `projectChunkLocal` ([`shaders/chunkProjection.ts`](shaders/chunkProjection.ts), prepended by material.ts; the same function the rocks, the snow sheet, the tunnels and the water use) computes the world position as `wrapOrigin + mat3(modelMatrix) × position`: the chunk origin wrapped to `WORLD_WRAP` (4200) plus a chunk-local offset — never one absolute float32 number — snaps it to the grid (`quantizeWorldPos`, [`vfx/quantization.ts`](../vfx/quantization.ts)), writes `vWorldPosWrapped`, `vWorldPosAbs` (the unwrapped position, for lighting lookups only) and `vWorldNormal`, takes the view position as `modelViewMatrix[3] + mat3(viewMatrix) × offset`, measures `vFarDistance` from it, and adds the world curvature LAST, in view space (`curveViewPos`, [`vfx/curvature.ts`](../vfx/curvature.ts): purely visual; physics and the heights above stay flat).
3. From those: `vWorldUv` (xz / `TEXTURE_TILE`, 26.25), `vHeight`, `vSlopeAngle`.

### Fragment shader (generated, in this order)

0. These run only in the ONE `discard` variant (`TERRAIN_LOD_FADE` + `TERRAIN_FAR_FADE` + `TERRAIN_HOLES`,
   `createDiscardMaterial`: chunks mid LOD swap, chunks reaching the last 72% of `camera.far`, chunks touching
   a hole or skirt mask, every chunk while the player is underground). **LOD cross-fade**: the pixel is
   discarded unless its screen-door threshold lies in the chunk's `uLodFade` range (`lodFadeDiscards`,
   [`shaders/lodFade.ts`](shaders/lodFade.ts); [`terrain/lodSwaps.ts`](terrain/lodSwaps.ts); a settled
   chunk's range keeps every pixel). The **far fade**. Then the **tunnel openings**: a pixel in a manhole shaft's cylinder or a cave mouth's
   footprint (by the entrance fade's screen-door share) is discarded, and a skirt pixel inside a skirt
   mask, or any skirt while the camera is underground (`terrainHoleDiscards`,
   [`shaders/terrainHoles.ts`](shaders/terrainHoles.ts)). The cave ENTRANCE patch (`ENTRANCE_PATCH`) keeps
   the complement of that share and never draws a skirt.
1. **Per biome slot, crispest tier first** (mirroring the CPU's `combineSlotWeights`):
   1. The weight is `smoothstep(-1, 1, sdf)`. The tier claims `remaining × weight`, and softer tiers
      split what is left.
   2. A slot whose share is 0.002 or less is skipped entirely; no texture is sampled for it.
   3. Otherwise the biome's color is its REGION's `<region>_base_frag`, mixed into its own
      `<biome>_frag` by `smoothstep(0, 1, presence)`. At a biome's edge the region base shows.
   4. The colors sum by weight.
2. **Normalize:** `blended / weightSum`.
3. **The river bed and banks**, where `vRiverBedDistance < RIVER_BED_REACH`:
   1. Each biome's riverbed texture (its `<Material riverbed>`, else the domain's river texture) is
      cross-faded by its OWN weights (`bedW*`, from `vRiverbedSdf` in the same crispness tiers), each
      wall's feather at least `RIVER_BED_TEXTURE_HALF` (8u) wide.
   2. The bed takes the ONE bed shade (`bedShade`, [`shaders/common.glsl`](shaders/common.glsl): the
      sand darkening and cooling over 24u of water depth with a slow ripple — the lake floor's frag
      uses the same, so a channel runs into a lake with no seam).
   3. It replaces the ground out to `RIVER_BED_REACH − RIVER_BED_FULL_INSET` (10) and fades into it
      over `RIVER_BED_BLEND_WIDTH` (9 factor-1 units) by `RIVER_BED_REACH − 1`, except where the CITY's
      road field says pavement (the city's weight × the road band up to `ROAD_HALF_WIDTH + 5`): a quay's
      asphalt, curb and sidewalk stay crisp.
   4. On a steep bank of ROCK (a domed biome, `bedYieldsToSteepGround` = `isRockBiome`; scaled by the
      rock slots' bed weights) the bed fades out by slope (`RIVER_BED_SLOPE_START_DEG` → `_END_DEG`,
      30° → 40°, from `vWorldNormal`), on the BANKS only (under the water the slope rule fades out over
      `RIVER_BED_UNDERWATER_FADE` of depth), so a mountainside rising out of the water keeps its own
      ground. Any other ground stays under the bed however steep. Beyond the first steep bank it does
      not come back: step 7 already capped `riverBedDistance` there.
4. **The road corridor**, where `vDistanceToRoadCenter < 9.5`: the CITY's own `city_frag` is painted
   over everything above, faded over 8–9.5 street units. That frag paints the asphalt, curb,
   sidewalk and the dashed lane lines from `vDistanceToFreewayCenter` / `vFreewayAlong`, with an
   `fwidth` seam guard ([city `fragment.glsl`](domains/overworld/regions/city/biomes/city/shaders/fragment.glsl)).
   This is how runs and the belt's outer half look exactly like city roads. It comes after the
   biome mix and the bed, so no biome's presence can fade a freeway.
   Then **the ground's snow**, where `vFarSnow > 0`: the pixel whitens by the vertex's snow depth
   (full by 0.35u) in a drift-varied white under the fake sun — at every LOD, the same color the near
   snow sheet stands in.
5. **Night dim** (`nightDimGLSL`, [`lighting/dayNight.ts`](../lighting/dayNight.ts)). Then, in the
   ENTRANCE variant only, the patch blends into the tunnel rock by its rock share (`vEntranceRock.x`),
   lit by its daylight (`vEntranceRock.y`, [`shaders/tunnelRock.ts`](shaders/tunnelRock.ts)
   `tunnelRockColor` / `tunnelShade`): the rock dims only what its daylight reaches, so it comes
   after the ground's dim and is never dimmed again.
6. **Lamp glow** (`lampGlowAccumGLSL`, [`lighting/lampGlow.ts`](../lighting/lampGlow.ts)), added
   AFTER the dim so lamps brighten the ground. It uses `vWorldPosAbs`.
7. **Scene point lights**, a lambert loop gated on `uNightBlend > 0.001`.
8. **Dither** (`ditherGLSL`, [`vfx/dither.ts`](../vfx/dither.ts)).

## Summary

| # | step | where | height? | material? | overrides |
|---|---|---|---|---|---|
| 0 | decks and cave mouths in reach | `decksAround`, `mouthsNear` | – | – | (fetch only; clobbers scratch) |
| 1 | road warp | `warp` | – | – | – |
| 2a | biome cell → zone (region via the site) | `getBiomeContext` | – | – | – |
| 2b | river field (distance, factor, surface, flow, bed limit) | `riverFieldAt` | (input to 8) | (input to bed) | – |
| 3 | nearest freeway + grade | `nearestFreewayRun`, `findNearestCityWall`, `freewayGradeAt` | (input to 9) | – | – |
| 4 | wall pass | `accumulateWallFields` | indicators | sdf, presence | – |
| 5 | zones × (region base + biome × presence), crisp tiers | `combineZoneWeights`, `zoneBiomeHeight` | ✔ | – | – |
| 5′ | city plateaus, roads, curb dip, quay | `getCityTerrain` | ✔ | road field, lane paint, bed cap | – |
| 6 | lake level + shore lift (the city's curb under it) | `lakeSurface`, `shoreLift` | ✔ | water | step 5 |
| 7 | bed limit cap (the bed ends at the first steep rock bank) | `capRiverBed` | – | bed | 5′ |
| 8 | river channel + banks, mouth, flow, merge beside a lake | `carveRiverChannel`, `riverMouthShare`, `riverLakeMerge` | ✔ | water, flow, bed | steps 5–6 |
| 9 | off-city freeway grade, curb dip, road field | `gradeOffCityFreeway` | ✔ | road field, lane paint | 8 (not in the channel) |
| 10a | cave mouth bulge (mound, hood, ledge; 0 on roads, rivers, water) | `applyMouthBulge` | ✔ | – | 5–9 |
| 10b | flatten pads | `applyFlattenPads` | ✔ | – | 5–10a |
| 11 | deck approach / mouth / cut / fill / paint-off / mouth paint | `cutGroundUnderDecks` | ✔ | road, lane, water | 5–10 |
| 11b | lane paint ends before undecked rivers | step 11b | – | lane paint | 5′, 9 |
| 12 | road fragments, block islands | `inRoadFragment`, `blockIslandAt` | road's height (islands) | road field, lane, bed | 5′, 9, 11 |
| 13 | the riverbed's texture distances | `riverbedSdfAt` | – | riverbed sdf | – |
| 14 | water depth; the spring caves' water and its dive | `springWaterAt` | – | water, depth, flow | 6, 8 (under the mountain) |
| GPU 0 | LOD cross-fade, far fade, tunnel openings and skirt masks (their variants) | generated frag | – | ✔ | – |
| GPU 1–2 | per-biome base→own by presence, crisp-tier weights | generated frag | – | ✔ | – |
| GPU 3 | riverbed per biome, its own soft weights, the one bed shade (not on steep rock banks) | generated frag | – | ✔ | biome mix (not city pavement) |
| GPU 4 | city/freeway corridor + lane dashes; the ground's snow; the entrance patch's rock | `city_frag`, generated frag | – | ✔ | biome mix + bed |
| GPU 5–8 | night dim, lamp glow, point lights, dither | generated frag | – | ✔ | everything |
| VS | wrapped origin + offset, quantize, curvature | `projectChunkLocal` | visual only | – | – |

## Gotchas

- **Scratch buffers are shared and clobbered.** Most pipeline outputs are module-level scratch:
  - the wall-pass scratch: `zoneWeights`, `zoneFinal`, `biomeSdf`, `biomePresence`;
  - `riverSample`, `riverQuay`, `nearestRun`, `springWater`, and the shore state.

  Any call that evaluates another point overwrites them. That includes river list builds, grade
  samples, deck enumeration, cave generation, pad candidates and the fragment flood fills. This is why
  steps 0 and 2–3 run before the vertex's own wall pass, why step 10 copies the sdf and presence into
  their own result buffers, and why step 12 saves and restores them. A caller that keeps a result must
  copy its arrays.
- **The shore state is implicit.** `shoreLift` (and `blendedTerrainAt`) lift by whatever the LAST
  `lakeSurface` call stored. Every sampler must call `lakeSurface` for the point it means first:
  `terrainOnlyAt`, `riverPieceEndSurface` and `roadCrossingCap` (through `setShoreAt`, `rivers/riverSurface.ts`) all do; step 9's
  fallback grade reuses the vertex's own.
- **Nothing reads a height on a stepping thread.** The movement modifiers (`surfaceModifiersAt`: the
  snow's drag and traction) run the pipeline and may generate a cell's caves; the Player, the local
  actors and the server's walkers sample them on a worker and hand the last answer in (physics/README.md).
- **Depth precision.** Near a deck's ends the ground sits 0.08u under its top, which the depth buffer
  resolves only within ~200u; the deck material's `polygonOffset` ([`deckMaterial.ts`](../objects/dressing/bridges/deckMaterial.ts))
  wins those ties at any distance. Nothing here changes for it.
- **Float precision.** Generation is float64 on absolute world coordinates; never rebase it. The
  shader never forms an absolute float32 world position: it uses the wrapped origin plus an offset,
  and any world-space period it reads must divide 4200. `vWorldPosAbs` is for lighting falloffs
  only. See CLAUDE.md, "Coordinate Precision".
- **Determinism.** Every value is a pure function of position and the config, and caches only store
  pure values:
  - chunk borders, workers, the main thread and the server all agree;
  - `initCompute` clears every position-keyed cache (the tunnel systems, the drawn ground, the snow
    cover, the spring water among them), since a domain switch changes the terrain under the same keys;
  - enumerators own their points by position.

  A new cache must be cleared in `initCompute`, and a new sampler must not read state left by
  another point.
