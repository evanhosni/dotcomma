# CHANGES.md — the region / river / water / address / bridge round (Sept 23, 2026)

This is the record of what landed in this round, why, what was measured, and what is
still open — the starting point for the next round. `CLAUDE.md` is the reference for how
the systems work; this file is the narrative: what was asked, what was built, what was
tried and thrown away, and what to look at next. Nothing here is committed or deployed —
Evan ships everything himself. Verified at `localhost:3000` (headless Chrome screenshots),
`npx tsc --noEmit` clean for client and server, client suites 26/26, server suites 23/23.

---

## 1. What was asked

1. **Drop the dimension level.** Only REGIONS and BIOMES; a region contains several biomes;
   nothing is larger than a region.
2. **Content:** remove the test dimension/region. Keep the city/grass region (city + grass
   biomes), the desert region with a second fitting biome, a snowy region with tundra and
   mountain-top biomes, and an ocean region made of lake biomes.
3. **Rivers line the edges of BIOMES, not regions** — on a region boundary or inside a region
   between two biomes; regions get a `river_probability`; rivers attach to lakes; branching allowed.
4. **A Water system** "much like the Terrain system": workers allowed, moving vertices or the
   illusion of motion in shaders; the terrain dips to a sea floor, the water mesh floats above.
5. **Regions blend into each other** as they did (keep the city's crisp edge). Regions have a
   BASE terrain; biomes blend into their own terrain — material and texture and height — so a
   mountain biome with a large blend distance shows the snowy region base at its edge and
   slowly climbs into rock.
6. **Procedural names for the region AND the biome**, themed on what they are
   (`evening-eddy-ville`, `electric-ed-town` for a city), 2 OR 3 words.
7. **City-to-city freeways**, likely along biome boundaries; where a river runs between two
   cities, 1–2 BRIDGES connecting the freeways — DRESSING objects, not terrain, straight or curved.
8. Change biome/region logic freely to keep the hierarchy simple and logical; keep the file
   structure sensible and the code modular.

## 2. What was built

### 2.1 The hierarchy: DOMAIN → REGION → BIOME

- `<Dimension>`, `DimensionContext`, `DimensionSpec`, the third voronoi grid, the test
  dimension/region/biome and the unmounted grass-region duplicate are GONE. `Region` carries
  what the dimension used to: `baseNoise` (`<Terrain>` under a region), a sky, blend widths —
  plus two new things: a BASE MATERIAL (`<Material>` under a region → `<region>_base_frag`,
  `material.ts` + `shaders/base.glsl` in the region folder) and `riverProbability`.
- Folders: `src/world/domains/overworld/regions/<region>/biomes/<biome>/`; home is
  `domains/home/regions/home/`. Every region has `region.tsx` + `spec.ts` (`RegionSpec`) +
  `material.ts` + `shaders/base.glsl`; every biome `biome.tsx` + `spec.ts` (`BiomeSpec`, now
  with optional `water`) + `material.ts` + `shaders/fragment.glsl`.
- Grids: `regionGridSize` 3000 → biome `gridSize` 500. Ids: biomes CITY 1, DUST 2, GRASS 3,
  WIRE 4, SALT 5, TUNDRA 6, MOUNTAIN 7, LAKE 8; regions HOME 0, CITY 1, DESERT 2, SNOW 3, OCEAN 4.
- `DomainConfig` (`domainConfig.ts`, one key order): `{ flattenDescriptors, seed, regions,
  gridSize, regionGridSize, defaultBlendWidth, defaultHeightBlendWidth, roadNoiseParams,
  baseNoiseParams, river, biomeNoiseConfigs, cityConfig }`; `buildDomainConfigFromSpecs`
  builds it from the spec files for the server, the JSX commit builds the same and
  console.errors in dev if they differ.
- Content:
  - **city** (id 1): city + grass biomes, default base noise, grass base material, blue sky,
    `riverProbability` 0.35. The grass biome (originals, no duplicate any more) mounts the
    grass-building pads and a `GrassField` with `roadDistanceRange={[8.5, 99999]}` so blades
    keep off the inter-city freeways.
  - **desert** (id 2): dust (dunes) + **salt** (id 5, `blendWidth` 200, noise h6 s300 offset
    −8 → it sinks ~8u into the dunes, sidewalk texture as a cracked pan), own simplex base
    (260/1800), sand base material, ochre sky, 0.15.
  - **snow** (id 3): **tundra** (id 6, `blendWidth` 120, hummocks h40 s260, snow with scrub
    patches) + **mountain** (id 7, `blendWidth` 220, squared perlin h2600 s380 offset 70, rock
    texture), slow perlin base (600/4000), procedural snow base, 0.55.
  - **ocean** (id 4): **lake** (id 8, `water: { depth: 26 }`, `blendWidth` 90, lakebed
    texture), near-flat base (24/3000), wet-sand base, 0.6. Adjacent lake cells are one body
    (joinable), so the region reads as a sea with sand islands.
- CRT pages: `/city`, `/desert`, `/snow`, `/ocean`, three locked.

### 2.2 Blending: presence, on top of last round's rules

Everything from the previous round holds (one wall pass, crispness precedence, asymmetric
height windows, per-slot signed-distance material feather, `biomeSdf` in its own result
buffer). New: **presence** (`biomePresence`, per slot, `biomePresenceResult`): the signed
distance into the zone scaled by its `blendWidth` (`heightBlendWidth` for height), 0 on the
wall, 1 one width inside. The biome HEIGHT is multiplied by it (`zoneBiomeHeight`) and the
shader mixes the region's base frag into the biome frag by it — so a biome's own terrain and
texture grow out of the region's base at its edge, exactly as asked for the mountain. Crisp
zones (`heightHalf` ≤ 2, the city) have presence 1 everywhere.

Measured and fixed along the way:

- **A blend width must stay under half a biome cell.** The mountain shipped with a 450u
  feather on 500u cells: presence peaked at ~0.5 at the cell center and the "mountain" was a
  14u bump (the 900u/900 noise also barely varied across one cell — `terrainNoise` squares a
  ±0.5 value, so height 900 is a 225 ceiling and ~10 typical). Retuned to `blendWidth` 220,
  h2600 s380 offset 70: 87u peaks in a small cell, rising over ~160u.
- **World-level paint must be applied after the presence mix.** The inter-city freeway paint
  lived in the grass frag; beside the city (grass presence low) it faded to a green road
  with faint lane lines. It now runs once in `combineBiomeMaterials`, gated on the city slot's
  sdf `< 0` (the city paints its own freeways).

### 2.3 Rivers

- Rivers follow BIOME walls (region walls included). A wall is a river when BOTH its
  junctions roll wet (`junctionWet` in `getWalls`): any water cell at the junction → wet, else
  `seedRand` keyed by the ROUNDED junction position `< max riverProbability` of the touching
  regions. Rolling per junction (not per wall) chains rivers into branching networks that end
  at lakes; keying by position keeps every chunk in agreement. Both sides water → no river.
- Beside a city the centerline is pushed outside the belt freeway
  (`riverOffset = cityBeltRadius + freewayWidth + 4 + halfWidth` along the wall normal).
- Channel: parabola `river.depth` (5) below a SURFACE that follows the blended terrain along
  the centerline (`blendedTerrainAt − 1.5`), banks lift back over `river.bank` (22),
  `halfWidth` 14; `RiverConfig` in `TerrainParams` (`river` in `world/defaults.ts`,
  `defaultProbability` 0.45). The shader paints the river-bed texture under it.

### 2.4 Lakes and the Water system

- A biome with `water: { depth }` bowls `depth` below the region base. Its level is the region
  base at the cell SITE − 1.5, **blended across every water cell within 1.5 cells by a compact
  kernel** (`lakeLevelAt`). One level per cell was MEASURED as 1–3u walls of water on the wall
  between two lake cells of one body (5 jumps on a 3000u walk), and the shore side's
  "base − 1.5" disagreed with the cell's level at every shore. After the blend: 0 jumps > 0.3u
  on the same walk. The kernel's support fits inside the 5×5 grid window, so it never steps at
  grid-cell borders. `blend.test.ts` asserts no 2u step > 0.1u across 600u of lake.
- `VertexResult.waterHeight` (NaN where no water is in reach) comes out of the same terrain
  worker pass and becomes a SECOND mesh per terrain chunk — a child of the chunk plane on
  pooled geometry with a `waterDepth` attribute, sharing the chunk lifecycle (`Chunk.water`,
  `releaseWater`). `world/water/waterMaterial.ts`: swell in the vertex shader, two scrolling
  fbm normal octaves, fresnel, sun glint, depth tint (turquoise → slate), alpha fading over the
  last 0.6u of depth (a hard `discard` traced the LOD triangles as a staircase along every
  shore — screenshot), night dim, dither. `tickWater(clock)` from TerrainRenderer.
- Foliage skips submerged points. Travel by address lands ON the water in a lake.
- Physics does not know water: the player walks the lake floor. Swimming is open (§4).

### 2.5 Addresses: `/<region words>/<biome words>`

- Both the region-grid cell and the biome-grid cell are named. Encoding: zigzag →
  bit-interleave → low 12 bits scrambled by `0xa6d` (mod 2¹²) → 8-bit ADJECTIVE words + one
  4-bit NOUN from the THEMED list of what stands there (`THEMED_NOUNS`: 16 words per region type
  and per biome type — `cityb` for the city biome, `generic` fallback). Two words within ±32
  cells, three within ±512, four beyond. The noun decodes from ANY theme's list, so the theme
  only changes the word, never the place. Examples from the real map: `/famous-sprawl/velvet-town`
  (city), `/famous-sprawl/cotton-glade` (grass), `/amber-lakelands/twin-pool` (lake),
  `/deep-winterland/hushed-spire` (mountain), `/windy-flats/empty-plate` (salt flat).
- Type forms: `/city` → the city region's cell nearest the origin; `/snow/mountain` → the
  nearest mountain cell there. `FastTravel.tsx` uses `resolveAddress` and `pathForPlace`.
- FROZEN: 256 adjectives, 16 nouns per theme, unique across all lists (module-load assertion —
  several nouns were renamed for collisions: hollow → trough, reach/flat/shelf/ridge/basin/
  quarter/expanse/field/tract/stretch/square/green/plain), scramble constant, seed, region/biome
  order, grid sizes. `address.test.ts` pins `amber-lagoon` = cell (0, 0) with the lake noun.

### 2.6 Inter-city freeways and bridges

- Two city cells within 2 grid steps are joined by a straight RUN between their sites
  (`freewayRunsOf`, cached per grid array) unless a third city lies within 0.55 cell of the
  line (relay). Outside the city, within `freewayWidth + 10` of a run the terrain rides the
  GRADE (the blended terrain at the centerline, flat across, 10u ramp) — except across a river
  channel, where the grade follows the channel mask so the water stays open under the road, and
  the paint varyings are only set where the mask is 1 (no lanes on the riverbed). Paint =
  `freewaySurface` in `common.glsl` (asphalt, shoulder, dashed lanes with the city's `fwidth()`
  seam guard), `#ifdef FREEWAY_HALF_WIDTH`-guarded because the water shader shares the file.
  Spawn filters see the run via the normalized `distanceToRoadCenter`.
- **Bridges are DRESSING** (`objects/dressing/bridges/`): `bridgeSpec.ts` (Three-free numbers +
  `bridgeSegments` / `bridgePierColumns` / `bridgeSegmentColliderParts`), `Bridges.tsx` (deck as
  a chain of unit chords with parapets in one merged vertex-colored geometry, pier columns
  scaled from the riverbed to the underside; two InstancedMeshes per chunk; render distance
  900), mounted from the city biome's `<Dressing>` (the crossings stand outside the biome, but
  the freeways are city infrastructure). Straight or ARCHED (parabolic camber ≤ 5u, seeded per
  crossing, 50%).
- Enumerator `getFreewayBridges(minX, minZ, maxX, maxZ, params)` in `vertexCompute.ts`, worker
  message `FREEWAY_BRIDGES` (skips the city probe). Every run × river-wall crossing is MARCHED
  along the run both ways (1.5u steps, ≤ 300u) until the river reach is cleared plus a 3u
  abutment, stopping at the city wall (where the belt lanes take over); overlapping spans of one
  run MERGE into one deck. The first version computed the span from the crossing angle
  (`reach / sin θ`, clamped) and was REJECTED after probing 18 bridges: at a river bend near
  (−6000, 120) three decks ended inside each other's water (ends at river distance 1–26u) and an
  oblique crossing overshot 2.8u into the city. After the march: 16 bridges, every abutment on
  graded road with river ≥ 38u or at the city wall, the bend spanned by one 311u arch on 38 piers.
- **Colliders with pitch.** The Dressing base grew `DressingColliderPoint.pitch` + per-point
  `parts` and `DressingColliderPart.z`; `DressingPartColliders` rotates `[0, yaw, pitch]` (Euler
  XYZ = qY·qZ). The server mirrors it: `obstacles.ts` enumerates bridges BEFORE its city probe
  and composes the same quaternion by hand, so NPCs walk across too. Collider distance 140.
- `cityFeatures.test.ts` gained a bridge case (determinism, chunk ownership, abutment validity,
  open channel under the midpoint, ≥ 1 pier column); the server's obstacle test now scans the
  dressing chunks around a real city patch instead of the world origin.

### 2.7 Fixes found only by looking

The headless-screenshot pass (see `memory/headless-screenshot-verification.md`) caught two
shader compile failures that made the ENTIRE terrain vanish (only grass and dressing drew):
the tundra frag used `patch` — a GLSL ES 3.0 reserved word — as a variable, and the water
shader pulled `common.glsl` in without `FREEWAY_HALF_WIDTH` defined. Both fixed; always read
the page console (`THREE.WebGLProgram: Shader Error`) before judging a screenshot.

## 2.8 Round 3 (Sept 23, later): the wall network — freeways and rivers reworked from screenshots

Evan's screenshots after 2.6 showed: three near-parallel connecting freeways out of one city and
one skimming its belt; a grass gap and a material change where a run met the belt; belt lane
dashes running through a merge; no median studs on runs; terrain rising through bridge decks;
rivers made of disconnected/overlapping segments that stopped dead; dunes 20u under the
ocean's level; the belt cut in half where a city borders the ocean; blocks standing far off
the belt; roads that ended in the middle of nowhere. Everything below is in `vertexCompute.ts`
(`getNetwork`, steps 4–5, the bridge enumerator), `_material.ts`, `Dressing.tsx`,
`bridgeSpec.ts`/`Bridges.tsx`, `obstacles.ts` and the specs.

- **The wall NETWORK** (`getNetwork`, per biome-grid cell, over a 37×37-site window with its own
  Delaunay): freeways and rivers both live ON biome walls. FREEWAYS FIRST: adjacent city cells
  form one city; every pair of cities within 4 cells gets a shortest wall path (heap Dijkstra,
  no city/water/`prohibitRoads` walls, third cities relay, detours > 1.7× dropped), PLUS every
  ≤2-wall / ≤450u "gap hop" between two different city cells (the lobe gaps Evan circled). The
  wall set is walked into polylines; every run starts at a wall junction = a belt corner. RIVERS
  SECOND, keeping off freeway walls: trees rooted at lake shores, STEERED toward the nearest
  other shore so most connect at both ends (18-wall cap), forking occasionally, ending at a
  confluence or in water; a river that won't reach water FIZZLES over its last 3 walls into
  2–4 arms that thin to nothing (rare, one end only). Widths per junction (1.8 at the lake →
  0.35, jittered), every river distance normalized by the local factor; config 40/9/36 (twice
  the previous half-width, wider spread). Nothing within 3 cells of the window border is trusted.
  Routing roads AROUND rivers was built first and REJECTED: a river is a chain that can start far
  outside a window, so two windows disagreed on a road's path and the road ended at a cell
  border — the "incomplete freeway" screenshots. With roads first, both are consistent (probe:
  every run near a window is present in the network of the cell each of its points lies in).
- **The belt is CENTERED on the wall** (`cityBeltRadius` = 0). Its outer half — over grass,
  dunes or a lake (a causeway on the city's grade) — is graded, curb-dipped and painted by the
  same step-5 code as the runs, so a run and the belt meet as one road-network node: no gap, no
  material change. Belt markers no longer need a city-side test; the river beside a city sits
  past the belt's outer half + the widest river's full reach + the meander.
- **One road material**: off-city freeways are painted by the terrain shader calling the CITY'S
  OWN `city_frag` through a corridor mask on the normalized road field (8–9.5 street units),
  over the finished biome mix and not gated on being outside the city (the 2u feather had tinted
  the belt's centerline green). `freewaySurface` deleted. Lane paint is blanked in the merge
  mouth (both a run and a city wall within fw + 12) so the belt's line reads as branching off.
  `distanceToRoadCenter` is 99999 off-road and written continuously to 70u (a 99999 next to a 9
  aliased the corridor edge into the triangle grid). Runs get the raised median studs
  (`getFreewayRunMarkers`, served outside the city probe).
- **Rounding**: river distances combine by a smooth minimum and are measured from a
  simplex-meandered query point — fillets at confluences, winding edges; freeways get the same,
  gentler, and the belt/run merge mouth is filleted too. River centerlines are per-wall segments
  MITERED at junctions (two offset walls miter; an offset wall pulls its unoffset tributary's end
  out to itself) — per-wall offsets had left gaps, overlaps and tributaries starting 100u short.
- **Water discipline**: the lake's terrain is defined relative to its LEVEL (shore at level +
  1.5 on both sides); land within 160u of a water wall is lifted to the shore height and fades
  back over 250u (also inside `blendedTerrainAt`, so river surfaces and road grades beside a
  lake lift with the ground); river channels are FORCED (rim at surface + 1.5, banks raise low
  ground too). Probe: 0 land-below-water samples over two 5000u scans (was 6, worst 22u).
- **Bridges**: crossings = offset river centerlines cutting a run + run vertices a river passes
  through; the deck stops at the belt's outer curb at a run's city end, follows the run's bends
  (chords per leg), and its arch is RAISED to clear the highest water it crosses by 4.5u (beside
  a city the river runs on ground above the belt grade and a straight deck dipped under it);
  the bank under the deck footprint is cut below the water so it can never rise through the
  deck. Server colliders per chord (`obstacles.ts`, pitch composed as qY·qZ).
- **Blocks nearer the belt**: the belt's road-field recovery starts at 9.5 street units (one
  curb strip past its asphalt) instead of an arterial's 12.2.
- `prohibitRoads` on `BiomeSpec` (plumbed spec → context → commit → config → server); the lake
  sets it.
- Tests: `cityFeatures.test.ts` scans 48×48 chunks for bridges (they sit on runs, not around the
  city center), checks abutments against the road field (lane paint is blanked in merges),
  any-point-over-water along the deck and piers under decks ≥ 3 stations; the server's beeble
  test tolerates 1u on its 23° salt-flat spawn slope. Final: client 51/51, server 23/23.

### 2.9 Round 4 (Sept 23, later still): rivers off the cities, confluences, crossings

Evan's next screenshots: two rivers running parallel a strip apart, rivers not reaching the
water, and a river INSIDE a city lobe. All three came from the river offset beside cities
(each lobe got its own shifted copy of the wall river; in a narrow gap the shift landed inside
the far lobe). Changes:

- **Rivers never touch a city.** Walls with a city cell on either side and junctions on a city
  wall are not candidates; the offset and the miter code are gone. Rivers may take an INTERNAL
  (same-zone) wall at a cost, which is how they thread the gap between two city lobes (the red
  line Evan drew); such walls are `riverOnly` in `getWalls` and contribute nothing to blending.
- **Confluences, not parallels.** A candidate junction already on a river gets a join bonus, one
  within 170u of another river's junction (without joining) a penalty; every merge multiplies
  the widths downstream of the meeting point by 1.18 (cap 2.8) — rivers widen toward the water.
  Wall factors are derived from junction widths after all traces.
- **Crossing a freeway.** With rivers and roads both on walls, a river reaching a road junction
  found both other walls taken and STOPPED — the "rivers that don't connect" and, with zero
  crossings, zero bridges. It now continues along a chord through the cell on the far side of
  the road to one of that cell's junctions that lies on no road (a chord ending on a later
  junction of the same road made the river run beside the road for 400u and was forbidden).
  The bridge enumerator finds the crossing at that junction; probe: every crossing yields one
  deck again.
- **Sources** are shore junctions touching exactly one water cell (two-water-cell junctions have
  no inland wall and died at step 0 — most of the "dead ends" in the counters). Boxed-in rivers
  end with a thinned tip. Steering strengthened (1.6), wander reduced (0.4). Counters
  (`network.debug`): ~50–70% of sources reach another shore, the rest fizzle or dead-end.
- `prohibitRoads` on `BiomeSpec` (lake sets it); freeway detours capped at 1.7×.

### 2.10 Round 5 (Sept 24): river coverage back, cut at the city, ponds

Banning rivers from every city wall and junction (round 4) removed most rivers. REVERTED to
the offset rivers beside cities, with one change Evan asked for: a river whose centerline
strays into a `prohibitRivers` biome (new `BiomeSpec` flag, plumbed like `prohibitRoads`; the
city sets it) is CUT at the first such wall — that wall and everything upstream are dropped —
and the river ends where it was cut in a small round POND (`RIVER_POND_FACTOR` on the end
junction's width: a fatter capsule end is a pond). Boxed-in rivers end in a pond too; rivers
that run out of length still fizzle into arms (both endings exist, as asked). Kept from round 4:
confluence preference, downstream widening, freeway crossings by chord, single-water-cell
sources; the parallel test now compares river CENTERLINE midpoints so two offset rivers a strip
apart count as parallel. Offset centerlines are mitered again and the bridge enumerator's
segment-cut crossings are back. Counters in the city window: 25 sources → 31 arrivals at water
(branches included), 21 fizzles, 4 dead ends, 10 cuts, 8 river/freeway crossings. Client 51/51,
server 23/23.

Open after round 5: a cut river's pond sits right at the city's edge where the river left the
gap, which may read as a moat when it happens on a long straight wall; a river whose centerline runs on ground higher than the land beside it
raises that land to its rim (the forced bank), which reads as a levee ridge and gives a road
crossing the bank a steep hump — the river SURFACE should probably follow the lower bank;
rivers still cannot thread a ONE-cell-wide gap between city lobes (every junction there touches
a city); dead ends beside roads whose far cell is a city or water; the far-LOD water sheet on steep banks (the 17.5u+ terrain quads skip the
rim, so the water surface shows above the bank until LOD1 arrives); a small plaza island can
survive inside the belt where a street meets it; runs cross snow/desert with the city's asphalt
look (fine by Evan) but no per-region variation; rivers steered toward "another shore" may
return to the same sea 1500u+ along the coast.

### 2.11 Round 6 (Sept 24, overnight): rivers on their own grid, cities adapt to them

"Rivers are still not merging into the lakes/oceans, and going within the bounds of the city.
I think we need to completely rethink river logic" — and Evan's own idea: a larger voronoi grid
with a random offset, its EDGES being the rivers. Adopted. `getRiverSegments`
(vertexCompute.ts): a third voronoi grid (2800u, jittered sites shifted by (1237, 811)),
independent of biomes and roads, so every window agrees by construction (probed: bit-identical
segments between neighboring windows once wall direction was canonicalized by junction key).
Each wall keeps with p = 0.78; a junction left with one wall is a pond or a fizzle end. Widths
are per junction, jittered, growing toward the ocean region; every river distance is normalized
by the interpolated factor as before. A wall is cut into 50u pieces and a piece ends the river
only when it is 160u deep into water in both directions along the wall — the mouth runs past
the shore rise into the bowl and its last piece is a pond, so the mouth widens. The whole
trace/A*/offset/chord/cut machinery in `getNetwork` is GONE (the network only routes freeways
now); `getWalls` appends the grid's segments as river-only walls; `wallsOfBiome` skips them.

First version cut rivers out of the city (footprint margin, ponds) and dropped stubs shorter
than 800u. Evan, from a screenshot: "no dont drop river segments... instead of preventing river
from going through city, just adjust city to account for river". So the CITY adapts
(`getCityTerrain`): a QUAY ROAD along each bank as one more road-field constraint, its inner
curb at the bank's outer edge, blocks chamfering against it like any street; on the river side
of the quay the field is the quay's own capped at the plaza band, so streets tee into the quay
instead of running into the water and nothing there can be block interior — buildings, lamps and
markers follow through the existing filters (`riverKeepOff` widened the dressing filters to the
whole bank). The river surface under a city samples the plateau FLOOR and sits 2.5u under it
(`RIVER_SURFACE_BELOW`), so the quay road stays above the water. BRIDGES now cover every road a
river crosses: `getFreewayBridges` marches `RoadPath`s of three kinds — the network runs, each
city's BELT (wall chains) and its ARTERIALS (the wiggly boundary curves, sampled and warped) —
with the same span/merge/camber/pier machinery; a city path ending inside the channel at a
junction gets a hanging end at the landed end's height. Half span 300 → 500. In the channel the
city's lane paint is blanked and the bank under a deck is cut below the water like the runs.
`prohibitRivers` remains on `BiomeSpec` but no biome sets it. Measured in a 13km square: 46
river/road crossings → 36 decks (runs 4/4, belt 20/24, arterials 12/18); the misses are roads
running along a river for > 500u (drowned there) and hanging junctions. Client 53/53, server
23/23. Screenshots: a quay with lamps, embankment sloping to the water, two decks over the
river inside a city; the mouth reaching the sea.

### 2.12 Round 7 (Sept 24): straight decks, no deck ends in water, straight quays, sand banks

From two screenshots: "curved" decks were chains of chords shoved together; several decks left a
city freeway and ended in the water; the quay edge along a river through the city was jagged and
its sidewalk smeared into the riverbed texture. Now: every deck is STRAIGHT — a span's polyline
is Douglas–Peucker-simplified (5u) and each leg is its own deck piece, heights linear along the
chain, so pieces meet only at real bends (a belt corner). An end that did not land on clear road
must ATTACH to a deck already built (belt → runs → row arterials → segment arterials) at that
deck's height, else the span is dropped — the hanging ends are gone. The quay follows the
UN-meandered river distance (its curbs were wobbling with the 90u meander), freeway fields are
exempt from the quay's river-side override (the belt lost its asphalt where it crossed the
bank, so its deck end sat on "sidewalk"), and the riverbed/bank is the desert's sand texture
painted as a crisp band to the bank's edge (the quay's sidewalk in a city) instead of a long
blend from `blue_mud`. Then, from Evan's next screenshots: the deck is ONE MITERED RIBBON mesh per
span (`bridgeRibbon`, merged per chunk) instead of instanced chords — the chords showed as
segments shoved together at every joint — and the sand yields to pavement wherever the road
field says sidewalk, so the sidewalk along the quay is the same constant band as beside any
road. Where one deck attaches to another they MERGE: the child is trimmed to the host's slab
edge and the host's parapet opens over the child's footprint (mesh and colliders alike); the
child's cut runs along the host's edge at the host's grade so the slabs share one edge. A segment
road end with no host deck continues onto whatever road passes through it (row, belt, run); the
march reach is 3000u so a road along a river gets a viaduct; belt chains come from the surrounding
cell windows with tolerance-clustered nodes; deck paths are sampled every 20u before unwarping so
they follow the road's real curve (a chord between warped points sat 15u off the belt); no asphalt
is painted inside the channel (it showed under the water). Measured over a 13km square: 44 distinct
river crossings; 12 had no deck at the start of this pass. Belt loops are unrolled past their seam,
segment paths end exactly on their row, and a run's wet city end hops onto the belt. After these: every
distinct crossing in the square has a deck (the one apparent miss sat at the square's edge, its deck owned
by a chunk outside it). Client 53/53, server 23/23. The shared placement filter now rejects the river channel and banks for
every object (lamps stood on the sand and in the water — the quay strip's field sits inside their
sidewalk band). Client 53/53, server 23/23.

### 2.13 Round 8 (Sept 24): bridges rebuilt geometrically

Evan: "still some unfinished bridges… consider understanding the goal of the bridges and completely
rewriting it to make it more efficient (they are incredibly slow to generate)". Rewritten
(`getFreewayBridges`): every road path is SAMPLED every 8u and each sample tested against the river
grid's segments (footprint × width factor + meander margin) — pure geometry, no terrain probing —
so a maximal wet stretch is one deck item with landed ends an abutment past the dry samples; an
end where the road itself ends while wet is OPEN and is joined to whatever road passes there,
end-to-end (walked into one chain) or as a T (trim + parapet opening). Heights: landed ends on the
road, junction nodes at the mean of their component's landed ends, T-children at the host's
height; chains with an unresolved open end are dropped. The march/attach/continue machinery is
gone. Also: the quay's river-side field is no longer capped at the plaza band (a plateau beside a
slope zig-zagged the interpolated sand edge — "jagged city edges"), and pavement is painted only in
the bank's last few units (a run's asphalt showed on the bank under its deck). Then: decks are built
lazily (only this chunk's chains and the hosts they need), wetness uses a spatial hash, each path is
walked once inside a 1500u window — 376 → 16 ms per chunk median; belt chains come from each
window's own center-cell walls over 5×5 windows (outer, distorted walls split a belt exactly at a
river crossing); nodes with three or more ends continue through their most collinear pair; the
under-deck asphalt is removed at the source (road field pushed past the pavement band inside the
footprint) instead of in the shader, which had made the quay's sidewalk edge wobble with the meander. The ground
under a deck is cut across the whole footprint (a belt viaduct along a bank had terrain through it).
The dev drift check had been reporting a client/server config mismatch since `prohibitRoads` was
added (the JSX path wrote `false`, specs omitted the key); `serializeBiome` now writes booleans.
Measured: 16–20 ms per chunk median (was 376); every in-square crossing decked except the ones on the
scan square's edge, whose owning chunk lies outside it. Client 53/53, server 23/23.

### 2.14 Round 9 (Sept 24): the river system rebuilt from its spec

The river system — network, channel, quay, water, bridges — was specified end to end (effects
only) and rebuilt from that spec, with Evan's answers to its open questions. What changed:

- **Uphill water → rivers avoid high and steep ground.** A 50u piece is not built where the biome
  relief exceeds 40u (the mountain's rock), where the ground climbs faster than 0.12 along it (over
  the piece and its neighbors), or where it would sit on a RIDGE (centerline 6u above both banks) or
  across a HILLSIDE (banks differing by > 0.15 across the footprint): the river ends in a pond before
  it. Judged on a cheap terrain proxy (zone base + presence-faded relief) — a real evaluation per
  piece would need every biome cell's freeway network across the ~20 km window. A built stretch under
  300u between two unbuilt pieces is dropped too (MEASURED: without it 197 of 363 stretches were
  pond blobs under 150u). The water SURFACE is now a function of the centerline only: the terrain at
  each piece end (its own wall pass, the city at its plateau floor, shore-lifted), interpolated along
  the piece — level across the channel (the old surface sampled the centerline with each vertex's
  own zone weights and tilted).
- **Regional river density is read.** An edge carries a river with probability
  `0.78/0.45 × riverProbability` of the region under its midpoint (capped at 1) — the default 0.45
  keeps the old 78%; the desert (0.15) keeps a quarter of its edges, snow/ocean nearly all. A
  domain whose probabilities are all 0 has no rivers at all (home — it had a 2.5u trench along every
  river line in its analytic height).
- **A road running along a river: the road wins.** Where a run, the belt or an in-city arterial runs
  within 35° of a river inside its footprint for 500u or more, that stretch of river is not built
  and it fizzles out over 150u on either side (lazy per piece — it needs the freeway network —
  cached on the edge). Crossings keep their decks; the angle gate is what keeps a GRID of separate
  arterial crossings from reading as one long stretch (an angle-free "road within the footprint"
  rule wiped rivers out of whole cities).
- **Confluences** combine by a compact smooth minimum over DIFFERENT rivers (24 factor-1 units; the
  pieces of one river are a plain min, so their joints never notch), and the width factor, surface
  and the quay's direction are weighted the same way — no argmin jumps where two rivers meet. The
  quay takes its distance, width and direction all from the straight (un-meandered) field.
- **Determinism fix, MEASURED:** river edges are cached by their two sites, and an edge first built
  from a distorted triangle near a window's border kept wrong junctions for every later query (a
  chunk's decks changed with what had been queried before). The site window is now ±6 cells and only
  triangles whose circumcircle sits a cell inside it may create edges; junctions are computed from
  their three sites in a canonical order, so they are bit-identical in every window.
- **Bridges:** wetness is now the terrain's own river field (a deck starts exactly where the ground
  stops being river — cut, sand, no paint), road samples sit on canonical lattices (each wall from
  its own smaller end, arterials on a global coordinate lattice — the old arterial samples depended
  on the query chunk), only roads within 60u of a footprint are sampled (belt walls from the cells
  the rivers touch, network-free), the road layer is resolved only where a road comes near, and the
  window is ±800u. Clearance and "submerged" are judged only over the drawn water (the channel), not
  the dry banks; a plain deck may arch up to max(16u, 10% of its length) to clear it, otherwise it is
  dropped, never drowned. A T-child's line is solved through its two end constraints (landed road
  height, and the host's height at its trimmed section). Deck art is one ribbon per chunk
  (`bridgeRibbon`), piers an instanced mesh through `finalizeInstancedChunk`, colliders one pitched
  chord per ≤ 6u station (`bridgeSegments`), the same stations the ribbon uses.
- **Dry pits:** where the under-deck cut lowers the ground below the river's surface, the water is
  drawn there too (the cut reaches the whole footprint, the water only the channel).
- **Far-LOD water:** dry vertices of the water mesh dive under the ground by at least the vertex
  spacing (was 3u), so a coarse chunk's one wet vertex no longer spreads a water sheet over the banks.
- **Removed:** the river-only walls appended to every biome cell's wall list (rivers have their own
  per-cell lists), every dead river field on `Wall`/`NetJunction`/`NetWall`/`Zone`, and the stale
  comments that still described rivers on biome walls.

Measured (overworld, Node): bridges 10.9 ms per chunk median around run × river crossings (warm; a
new area's first chunk pays the network and river caches, ~250–650 ms); terrain per-vertex cost
within ±15% of the previous build (warm 184–249 ms vs 161–312 ms per 96×96 LOD1 grid at four spots).
The `getFreewayBridges` test now searches for run × river crossings in rings of networks out to
12.5 km (the rivers are sparser: none crossed a run within the old ±7 km of its city). Client 53/53;
server 22/23 — `slides down a steep slope` now starts from a different grass patch (its search keeps
300u from rivers, and the rivers moved) and lands on a freeway grade cut, where the walker only
slides 0.74u; the slope search should skip road-graded spots.

### 2.15 Round 10 (Sept 24): performance audit of the rebuild, and two of Evan's calls

Evan's calls, applied: **`RIVER_MAX_GRADE` 0.12 → 0.2** (rivers climb more before they end), and
**blunt ends at the road layer** — a river no longer fizzles over 150u toward a stretch the road
wins; its last built piece keeps its full width (`RIVER_ROAD_TAPER`/`riverRoadScale` removed). The
network's natural dead ends keep their seeded pond/fizzle.

- **Bridge T-junctions agree across chunks.** The single ±800 window split a host and its child
  owned by different chunks (each saw the other cut off: a road into the water, a parapet opening
  onto nothing — 3 such pairs in 958 chunks around 13 crossing areas). Now: roads are clipped to
  the window instead of required whole; a chain with a sample within 48u of the window's edge is
  undecided there, and a chunk whose decks depend on one retries with a wider window (900 → 1800 →
  3200; at the last it drops); chains over 1000u drop whatever the window (so an owned chain always
  fits the first); the belt's chains and loop seams are canonical instead of order-dependent. An
  exact early out skips chunks no river comes near. MEASURED over those 958 chunks: identical to a
  ±5000 reference window, zero retries needed, zero orphan joins; warm 3.0 ms median / p90 7 / max
  32 per chunk (was 5.8 / 18 / 96 at ±800; the one-window ±2200 fix was 92–214 ms median).
- **Junction decks clear the water.** Every deck landed at both ends (a host or a merged chain too)
  takes the clearance arch; a deck with a T end lifts its landed end into a step of ≤ 0.5u (the
  character autostep) to clear 4.5u, or drops. MEASURED: 18 T-children built, 8 dropped (5 needing
  0.6–2.4u, 3 needing 5–28u). `cityFeatures.test.ts` allows that ≤ 0.5u step at a T-child's
  landed end (a user decision changed the behavior).
- **Terrain got faster, not slower** (the audit had one LOD1 sample at +39%). MEASURED per 96×96
  LOD1 grid (min of 3 warm passes, 36 chunks at four spots): pre-rebuild 154 ms median, the
  rebuild as audited 228, now 115; cold 16.0 → 8.4 s. The terrain worker's whole startup ring
  around a city spawn (228 chunks, every LOD): 90.8 → ~12–15 s of worker time. What did it, each
  change exact (same heights, same bridges — checksums compared after every step):
  - biome-grid SITES and their biome rolls cached per cell (`rawBiomeSiteAt`), and region sites
    (`regionSiteAt`): three `seedRand` per site per grid build were ~80% of a network build — a
    network miss 56 → 17 ms, a river-cell miss 91 → 25 ms;
  - `NETWORK_CACHE_MAX` 48 → 1024 (~10 KB each): the startup ring touches ~720 cells and rebuilt
    1331 networks at 48 (23.8 → 15.4 s alone); the network cache is now also cleared on init;
  - the biome grid is looked up before its region grid, in numeric maps (the region grid used to
    be resolved, key string and all, on every vertex) — same retention as before, since the wall
    memos key on grid identity; `getZoneWalls` sweeps its sides cache once per build (the same
    result as a sweep per new label): −12% warm, −15% cold;
  - the city's arterial wiggle phases keyed by number, not by "r12"/"wig1:r12" strings built per
    probe (≥ 4 probes per city vertex): city −23%;
  - `nearestFreewayRun` skips a run whose bounding box lies past the running smooth minimum + k
    (exact): its cost −43%;
  - the quay's straight river field is computed only for city vertices (`riverQuayAt`): the river
    field −13%;
  - Dijkstra state per network instead of per city pair (walkability, source lists, epoch stamps):
    ~7% of the routing, marginal.
- **Warm-up:** the water child mesh gets `uploadOnFirstDraw` like every streamed mesh (its program
  otherwise compiled the first time water came into view). Not measurable headless.
- **Bounded:** the city district-boundary caches (`cityRowBoundaryCache`, `citySegBoundaryCache`)
  grew with every district ever visited.

### 2.16 Round 11 (Sept 24): far terrain skips the runs, T-junction arches, network regions

Evan's calls (three authorized output changes), then the hunt for work that produces no pixels.
All numbers are MEASURED in node on the worker's own per-vertex loop: the terrain worker's startup
ring around a city spawn (-3800, 1200; 228 chunks, every LOD, one process, 3 runs each).

- **T-children arch (Evan's call).** A T-child whose landed end would need more than the 0.5u step
  to clear the water by 4.5u — or a chain with two T ends — now carries the CLEARANCE ARCH between
  its two fixed ends. `bridgeDeckY` spans the arch over the deck's drawn range (`bridgeTrimRange`),
  so it is exactly 0 where the child meets its host at the host's height, and the host is not
  touched; the ribbon, the colliders (client and server) and the piers read `bridgeDeckY`, so they
  follow the arch. Untrimmed decks are bit-identical (the span is exactly [0, 1]). The cap is the
  usual max(16u, 10% of the span); beside a T end, where the arch cannot help, the deck must still
  stand 2u over the water (`BRIDGE_JUNCTION_MIN_CLEARANCE`, the 1.4u slab kept dry) or it drops.
  MEASURED over 877 chunks around 13 crossing areas: before, 16 T-children built and 8 dropped for
  clearance (5 needing a 0.6–2.4u step, 3 needing 5–28u); now all 8 build — 6 arched (camber 0.1,
  0.17, 0.56, 1.47, 2.37, 10.39u), 2 with no rise (their only short samples sit beside an end, which
  no landed deck clears either). No clearance drops remain (2 "short T" drops, unrelated). Every
  other deck is identical except 7 hosts, whose `joins` gained the new children's parapet openings.
- **Far visual-only LODs skip the freeway runs (Evan's call).** `computeVertexDataFar` (pad-free,
  and `nearestFreewayRun` sees no runs) for the chunks the terrain worker builds with `visualOnly =
  !lod.hasCollider` — the message field that replaced `skipPads`. Collider LODs, the server, the
  main thread and every other worker keep full fidelity. Startup ring: LOD3 886–948 → 114–126 ms,
  LOD4 1570–1805 → 582–682 ms, LOD5 160–175 → 95–124 ms. What it costs visually: a far vertex that
  happened to land within ~24u of a run no longer snaps onto the road grade (314 vertices at 77
  run × LOD3-edge crossings in a 24 km square: max 9.9u, median 0.36u) nor smears asphalt paint.
  Seams: at those crossings the worst LOD2|LOD3 gap is unchanged — LOD2 ≤ 37.8u above the LOD3
  segment (skirt 80), LOD3 ≤ 36.4u above LOD2 (skirt 160).
- **LOD4–5 skip the river field (Evan's call).** New `LODLevel.carvesRivers` (false for LOD4 and
  LOD5), sent with `BUILD_CHUNK`; the terrain worker calls `computeVertexDataFar(x, z, false)`, which
  resets the river sample and quay (`noRiverSample`/`noRiverQuay` in riverField.ts) instead of
  evaluating them. Those chunks report no river water, no channel, and a bed distance of Infinity, so
  the shader paints no sand. Collider LODs, LOD3, the server, the main thread and every other worker
  still carve. Startup ring, 3 spawns, 2 runs each: LOD4 369–548 → 36–50 ms, LOD5 51–118 → 2–5 ms,
  ring −20/−31/−31%. ~5% of LOD4–5 vertices change (trenches up to 47.6u filled). Visually, about
  0.1–0.5% of true river water was drawn there, as specks. LOD3 was measured and kept: skipping it
  saves another 60–110 ms, but it draws 3–22% of its ring's river water. Seams over a 48 km square:
  at LOD3|LOD4 the edge sits ≤ 144.3u above (skirt 160) and ≤ 130.3u below (skirt 260), and a carved
  LOD3 river vertex sits ≤ 88.8u under LOD4. LOD4|LOD5 is unchanged. The same scan found a
  pre-existing, non-river LOD2|LOD3 gap of 115.8u on a mountain, past LOD2's 100u skirt.
- **Every network site gets its own region (Evan's call).** `buildNetGraph` zoned all 37×37 sites
  with the window CENTER's 5×5 region grid, which ends ~6000u out — inside the window's 9000u reach
  — so the outer sites took whatever region was nearest within it. Now each site is `biomeSiteAt`
  (its own region grid; the same cached per-cell zone the river network and bridges use).
  Deterministic and window-independent. MEASURED over 10,000 windows (50×50 km): every freeway wall
  in its window's own cell is unchanged (916 of 916); of the 183,173 (window, wall) pairs within
  3500u of a window's center, 356 were replaced by 805 others, in 330 of 9111 windows — i.e. the
  far runs a window reports, which the bridge scan reads (no deck changed in the 877-chunk set).
  TO REVERT: in `freewayNetwork.ts`, give `buildNetGraph` back its `rGrid: VoronoiCell[]` parameter,
  build each site as `const p = rawBiomeSiteAt(ix, iz); sites.push({ x: p.x, z: p.z, ix, iz, zone:
  zoneOfRawSite(p, rGrid) })`, call it as `buildNetGraph(cx, cz, getRegionGrid(warped))`, and
  restore the imports (`VoronoiCell` from ./types; `getRegionGrid, rawBiomeSiteAt, zoneOfRawSite`
  from ./voronoi). Nothing else depends on it.
- **The network is lazy** (`networkOf(ctx)`, exact): `getBiomeContext` built its cell's network
  for every caller, and river surfaces, sky polls and zone lookups never read it. Startup ring
  4817–5189 → 4293–4453 ms; `getPlaceInfo` + address over 676 probes 4470 → 174 ms. `getWalls` is
  gone (`getFreewayRunMarkers` calls `getNetwork` directly).
- **`seedRand` is an exact typed-array port of seedrandom's ARC4** (exact; `_math.test.ts` compares
  ~100k seeds bit-for-bit, and 1.8M in a node check): 4.3 → 1.9 µs per call. It was the largest self
  time. Startup ring 3126–3202 → 2722–2793 ms.
- **Cleanups:** the `console.log("rescue")` in the popstate handler is gone; `writeSdf` uses
  `MAX_BIOME_SLOTS`.

Startup ring overall: **4817–5189 → 2722–2793 ms (−45%)**; the exact changes alone (lazy network +
seedRand, far LODs still full) 3893–3928. The full-output hash dump (LOD1 grids, raw and padded
scans, places, rivers, bridges, city features) is identical to before except the network section
(the region fix) and the bridge decks listed above.

### 2.17 Round 12 (Sept 25): thirteen visual fixes from Evan's screenshots

Evan's screenshots of rivers through and beside cities (the famous-shallows river mouth, a snow
river, /ivory-precinct/smoky-row, junction close-ups, a physics-debug view). Each item was probed
numerically at the spot before it was changed, then shot headless (daylight forced by freezing the
shared `uNightBlend` uniform) before and after.

- **Quay sidewalk width (1).** The sand edge in a city followed the MEANDERED river distance while
  the quay follows the straight one, so plaza concrete showed between the sidewalk and the sand
  wherever the channel wandered away — the sidewalk bulged on a ~90u period. A new
  `VertexResult.riverBedDistance` (the terrain's `riverBedDistance` attribute) is the river distance,
  except that a city vertex reports at most the straight distance less 3: the sand starts exactly
  past the quay's river-side sidewalk. (Not the rejected "quay on the meander" nor "pavement gated on
  the river distance": the quay and the pavement are untouched; only where the bed is painted moved.)
- **Jagged asphalt/sand edges (2) and road paint under decks (3, 13c).** Step 5 pushed an off-city
  road's field past the pavement band with a HARD jump at the footprint's edge, which aliased into a
  sawtooth along the LOD triangles. It now RAMPS over the yield zone's last 10 factor-1 units, inside
  the region a deck covers — and decks now cover the road's whole cross-section (below). The bed
  paint runs before the freeway corridor, and only the CITY's pavement is exempt, so a run's curb
  strip fades straight into sand rather than grass. City rim cells ("all road") were applied after
  the quay's river-side override and painted asphalt under the water where a river crosses the city's
  edge; the order is swapped. Under and beside a deck, off the city, the road's paint gives way to
  the ground (faded in over 8u from each landed end).
- **Bridge rules (4, 7, 11a/b, 15, 17b, 18).** The V decks at the river mouth were the belt rounding a
  city lobe's tip in the river; the along-shore decks were belts and arterials following a bank; the
  stubs were chains teeing into decks at both ends; the wedges were "T"s onto another road's END.
  New rules (`freewayBridges.ts` header): open ends continue end to end only if nearly straight;
  a T host must pass the node; a chain between two decks drops; a belt/arterial deck landed at both
  ends must cross a river centerline an odd number of times at ≥ 40° and may not follow the shore
  (within 35° of the river inside its footprint) for more than 60u; no deck turns more than 45° per
  40u after its corners are rounded (`filletCorners`: a belt crossing at a wall junction becomes a
  curved viaduct instead of a kink); a T meets its host at ≥ 35°. Runs are exempt from the crossing
  and shore rules (they are the only road between two cities) and now yield to a river only near
  the water (`runRiverYield`, the water band + 6), so a run grazing a bank or a pond stays a road.
  A road that fails the rules has no deck — in a city it ends at the quay. MEASURED: 82 → 31 decks
  over the 13 crossing areas + the reported spots (1095 chunks), 90 → 26 over 2435 chunks around six
  city/river areas; most of the loss is T-children (31 of 34 gone in the survey) and belts along a
  shore. MERGING (7): where two independent decks overlap, their walls inside each other's strip are
  removed and the two read as one wider deck (`finishDeck`); a shallow T (a converging road) is not
  built. Twin decks side by side WITHOUT overlapping are not merged; none occur in the survey.
- **Deck ends (5).** Douglas–Peucker at 1.5u (was 5u — the end leg was askew to the road), and wetness
  judged over the road's whole cross-section (centerline or either deck edge), so an oblique deck
  extends until the whole road is dry and no curbed wedge of road shows past its end.
- **Junctions (6, 8, 11a, 12, 18).** Parapet openings are EXACT clips of each wall against the strip
  of every deck meeting it (shrunk by a wall's width so corners overlap), replacing the symmetric
  `joins` openings that left gaps and stubs. A T-child's trim is found along the child (the
  closed-form W/2/sin θ left a crack against a curving host) and moved in until its whole cut lies
  0.6u inside the host. The oblique cut is one section to the first square section past its farthest
  corner, computed against the real axes; axes are interpolated between the path vertices' miters —
  the old per-station miter/normal switch BOW-TIED quads near path vertices, which is what the dark
  overlapping triangles and the wedge-shaped holes (sand showing through the deck) were. Short legs
  (< 3u) are dropped. `bridgeSpec.test.ts` asserts no bow-tie anywhere in the test decks.
- **The deck looks like the road (8).** `deckMaterial.ts`: unlit, the city's `road.jpg` at the terrain's
  world tiling (same tile phase), city_frag's gutter and dashed lane lines, the terrain's fake shade
  with the top's SHADING normal straight up (so junction pieces pitched differently shade the same —
  a lit per-face normal drew a seam at every joint), night dim and lamp glow. Lane paint continues the
  terrain road's dash phase at each landed end (`BridgeLanePaint`) and stops 8u from another deck's
  edge.
- **Per-biome riverbed (9).** `<Material riverbed={{ texture, saturation?, tint? }}>` under a `<Biome>`;
  the snow region's tundra and mountain share `regions/snow/riverbed.ts` (the mountain's `dirt.png`,
  grayed and cooled into gravel). The terrain shader cross-fades beds by the same biome weights as the
  ground, samples each distinct bed once (one sampler per file), and falls back to the domain's river
  texture.
- **Water through the bank (10, 13a).** MEASURED: 2016 vertices over four 3km squares reported river
  water above their ground outside the channel — the bank blended low ground down from the rim at
  the half-width while the water was reported to `halfWidth + bank/2`, so a second strip of water
  (and the ring around smoky-row's pond end) showed on the dry bank. Ground lower than the rim is now
  held at the rim across the whole water band before it descends; the remaining cases were the old
  under-deck cut's pits (below). After: 0 at LOD1, LOD2 and LOD3 spacings (`riverBanks.test.ts`).
  The water mesh and the terrain share one grid per chunk, so the vertex guarantee holds on every
  triangle.
- **The ground under decks (11c, 13b).** The cut was local — every road inside a river's footprint cut
  down to the water, the pit drawn as water — so wherever a road had NO deck it left a dark jagged pit
  (and asphalt under water). It is now DECK-DRIVEN (`computeVertexData` step 7): each vertex fetches
  its 256u cell's decks (`getFreewayBridgesNear`, every deck reaching into the cell, cached; fetched
  first because enumerating evaluates terrain) and cuts the ground to 0.08u below the deck's top
  under exactly those, feathered 4u beside them, never below the water where it is drawn. Skipped on
  the raw/far paths and while enumerating (the landed ends lie on roads). Foliage skips
  `underDeck` points (grass grew through the decks once the ground sat just below them).
- **Parapet colliders (12).** A parapet's collider was a chord-wide box, so at a T end's oblique cut it
  ran on past the visible wall into the roadway. Each standing wall segment is now its own box along
  the wall (`DressingColliderPart.yaw`, mirrored on the server), and a T end's slab is six strips each
  reaching the cut. `bridgeSpec.test.ts`: every parapet box ends within 0.1u of the drawn wall.

Performance (measured, node): bridges 1.27 ms per chunk median, p90 2.8, max 12 warm (was 0.93 / 2.0
/ 8); terrain LOD1 96×96 warm unchanged at three bridge areas (42 vs 43, 41 vs 42, 52 vs 50 ms), the
first chunk of a bridge area +0–110 ms cold for its cells' decks. Client 65/65 (12 suites), server 23/23, `tsc` clean for both.

Tried and rejected this round: a MIN-crossing of 30° (a 33° belt crossing still read as a viaduct
along the shore); an along-shore rule with a 25° alignment (missed 30–35° diagonals); fillets on the
fine path (its short legs capped every arc's radius; the corners are found on a 5u view instead);
clipping a T-child's walls against its host (its cut already ends them; the clip ran into the
single-section sweep and removed the whole trapezoid's wall).

Open after round 12:
- **Connectivity.** Many fewer decks: a belt or arterial that runs along a shore, crosses at < 40°,
  or rounds a corner too sharp to fillet has no deck, and a T-child of a dropped host drops with it.
  In a city the road ends at the quay; an inter-city run whose belt corner lies in the water keeps
  its road (it only yields near the water) but may end at the bank where its host belt was dropped
  (5 runs in the bench). If Evan wants more decks back, the thresholds are `BRIDGE_MIN_CROSSING`,
  `BRIDGE_MAX_ALONG_SHORE` and `BRIDGE_MAX_TURN`.
- **Twin decks** (two parallel decks a gap apart) are not merged into one wide deck; overlapping ones
  are (walls removed). Filling the gap needs a variable-width deck.
- **The river mouth** at famous-shallows drops ~11u from the city's plateau to the lake over one 50u
  piece, and the two water surfaces meet as a stepped sheet — the river surface follows the terrain
  at each piece end; not one of the thirteen items.
- Grass still grows on sand banks away from decks (foliage keys on the biome weight).

### 2.18 Black far terrain (Sept 25)

Evan's screenshot: large BLACK patches on distant terrain, along snow/ridge edges and around far
cities and lakes. Probed headless at the spot: a magenta clear color with every sky mesh hidden left
the black in place (not holes), so did hiding every skirt (`setDrawRange` to the main grid) and every
water mesh — it was terrain fragments. Patching the terrain shader to paint magenta where
`weightSum < 0.02` turned exactly the black patches magenta: the biome weights summed to ZERO. The
blend fields are signed distances scaled by the feather half and ±`BIOME_SDF_FAR` (1e4) where no
wall is in reach; on a LOD3–5 triangle (210–3360u) spanning three zones, or mixing a far and a near
value, every slot interpolates below −1 somewhere inside it. FIX: `LODLevel.clampBlendFields` (LOD3–5)
clamps each vertex's sdf to [−1, 1] and presence to [0, 1] before upload (`writeSdf`,
TerrainRenderer) — exact at every vertex (the shader's smoothsteps saturate there) and a plain
cross-fade across the triangle; LOD1/2 keep the true distances (the city's 1u edge). No shader
change, no per-fragment cost. Magenta probe after: zero pixels in every view shot. Not changed: the
far LODs still show the lake biome's own DARK bed as a band at lake shores, where the far water
sheet dives (`dryDive` = the vertex spacing) before it reaches the shore — a 3u dive on the
river-free LODs covered it but washes a translucent sheet over the sand; left for Evan.

### 2.19 Round 13 (Sept 25): missing bridges, deck-end ramps, the mouth's water

Evan on round 12: "everything looks WAY better. i think this solution is great, but…" — three requests
(screenshots 19–21). Before/after shots in the session scratchpad (`r13/shots/*_before.png`/`*_after.png`).

- **Missing bridges (19, 21).** The strict rules stay; a river with city on BOTH banks also gets
  CROSSINGS OF ITS OWN (`freewayBridges.ts` section 6): straight decks at most 35° off square to the
  river, landed on pavement on both banks (the quay road counts), so none can follow a shore, kink, V
  or end in the water. ARTERIAL crossings where an arterial crosses the river (≥ 20°) with no deck
  within 120u — along the arterial, turned toward square; FILL crossings at least one per 350u of each
  in-city stretch (≥ 1 per stretch, so a short one between two city parts at a mouth gets one), none
  within 180u of another deck, snapped onto a street line of the district (preferring one whose street
  continues past both quays), street-width, no lane paint. Conflicts resolve by priority over
  VIABILITY only (one round, window-independent); geometry is cached across windows. Found numerically
  (`r13/find.ts`: every stretch of built river pieces with city at the quay offset on both banks, over
  a 44 km square — 159 stretches, 75.6 km): crossings 91 → 205; stretches with a gap > 600u 33 → 8,
  > 400u 60 → 28; city/river/lake mouths with a crossing 12 of 28 → 23. The 19-like stretch (1413u, 0
  crossings) now has 4 (3 new). The 1095-chunk bench 31 → 44 decks. A checker over the survey's decks
  (`r13/ugly.ts`, 241 before / 375 after) finds the same 4 non-T overlaps, 5 near-parallel twins and 17
  ends just inside the footprint as before — all natural decks; none involve a crossing. Deterministic
  under forward/reverse/shuffled chunk orders, one owner per deck, identical with the window forced
  to 3200.
- **Deck-end ramp (20).** A landed end's slab stood up to 1.8u over the road (p90 1.67) where the road
  fell across the deck's width (a 31u deck landing where the city plateau meets the belt grade). Each
  landed end now stores a cross-fall fitted UNDER the ground there, 0.15u lower (`BridgeLanding`), and
  the deck's last 10u blend into it (`bridgeRampAt`), parapets rising out of the ground; the ribbon and
  `bridgeColliderPoints` (client and server) read the same sections — the slab in 8 lateral strips at
  the tilted top's height, walls at their tapered height. After: every end section is 0.15u under the
  road across its whole width; within 5u of an end the underside stands at most 0.49u over the ground
  (p90 0.09). `bridgeSpec.test.ts`: every landed end under the road; slab colliders on the drawn top
  (within 0.02 + half a strip of cross-fall); wall boxes at the drawn height.
- **Stepped water at mouths (21).** MEASURED at famous-shallows: the river surface stood 10.9u over the
  lake at the lake's wall and fell to it within one 50u piece. `riverSurfaceAt` now eases onto the
  lake's level over 250u from the wall (never below it on land, never above it in the lake, where the
  channel must stay sunk or the bank rule raises a levee across the lakebed): 12.9 → −2.6 over ~250u,
  ≤ ~6% slope, meeting the lake level exactly. The deck cut under a deck now stays above ANY drawn
  water (a lake's too — a new mouth deck had cut its bank under the lake). `riverBanks.test.ts` holds.

Performance (node, warm): bridges 1.27 ms per chunk median, p90 2.9, max 17 (1.25 / 2.8 / 12 before);
cold median 1.55, p90 7.1; terrain LOD1 96×96 warm unchanged at eight areas, cold first chunk +20–80 ms.
Client 68/68 (12 suites), server 23/23, `tsc` clean for both.

Open after round 13:
- The lake's own shore still draws a staircase edge where its bowl is steep (every lake, not the
  mouth; the remaining small shards beside the famous-shallows mouth deck are this).
- A fill deck prefers a street line that continues past both quays; where none does within its snap,
  it simply meets the quay.
- 22 arterial crossings in the survey find no landing (no dry bank within 450u — confluences, ponds —
  or no pavement at the bank); the fill slots cover their stretches.
- Belts and runs get no crossings of their own (outside the city there is no quay to land on).

### 2.20 Round 14 (Sept 25): freeway bridges at the mouths, decks kept clear, fragments, rivers to the sea

Evan on round 13: "shores look good"; the Y-shaped confluence in the snow "looks great" (untouched).
Five items (screenshots 23–29), each probed at real spots before it was changed; before/after shots
in the session scratchpad (`r14/shots/*_before.png` / `*_after.png`, daylight frozen).

- **Freeway bridges at freeway mouths (23, 24).** "Some freeways abruptly end at the edge of the
  city … it would make the most sense to use freeway bridges", red lines: one straight on, one
  CURVED between two offset arterials; the small random crossings stay. A MOUTH is where a city
  arterial heading into a city river's channel is last dry across a deck's width (`mouthsOf`, per
  river edge, window-free). Two mouths facing each other get a freeway-width deck along a cubic
  Hermite tangent to both arterials (chord ≤ 300u and ≤ 45° off square, each arterial ≤ 50° off the
  chord, and every deck's rules: one centerline crossing at ≥ 40°, no kink, no shore); a lone mouth
  a straight freeway deck turned to 35° of square and landed within 24u of it. Mouth decks give way
  to a natural deck they overlap and take precedence over arterial and fill crossings (section 6b).
  MEASURED (28 km square, 113 arterial mouths): decks at a mouth 55 → 82, dead ends 60 → 31 (the
  rest run along the bank into the river, or sit beside a natural deck). Bench 44 → 48 decks
  (freeway 32 → 39, street 12 → 9). At the 24.jpg river (-4400, 700) the offset pair is now one
  curved deck and the street deck beside the other arterial a freeway one (`a_river_top`,
  `a_pair_top`). A mouth at a confluence belongs to two edges: its crossing key carries the edge
  (sharing one key made a deck depend on query order — caught by comparing the bench to fresh
  queries; forward/reverse/shuffled orders and a window forced to 3200 now agree bit for bit).
- **Nothing on a deck; decks higher; a longer ramp (25).** The lamp band's field ran under decks near
  their landed ends (the paint fade), so `passesPlacementFilters` now rejects `underDeck` > 0, and the
  marker/signal/pole enumerators test it too: lamps on a deck 2 → 0 (3476 lamps, 372 chunks). The
  grass through the deck was the ground cut only to the deck's LINE while the ramp dives under it, and
  the road's paint fading to grass there. Now every landed end's line stands `BRIDGE_DECK_LIFT` (1u)
  over the road, the ramp is 20u (was 10) and still dives 0.15u under the road (no lip), the cut
  follows the drawn top (ramp and cross-fall, from 3u in) and the road stays painted under the whole
  ramp. MEASURED over the bench's decks: ground above the drawn top 2428 → 844 points, showing
  something other than road 31 → 8 (`b_ramp_obl`). Colliders read the same sections (client and
  server); `bridgeSpec.test.ts` holds, `cityFeatures.test.ts`' abutments expect the lift.
- **Tiny road fragments (26, 27).** Not small voronoi cells (the smallest city cell's inscribed circle
  is 152u): a river cutting a strip of belt or a city corner off from every other road (26 is
  reproduced exactly at (-1384, 1017) before this round). Step 8 of `computeVertexData` flood-fills a
  land vertex's piece on an 8u world lattice (raw evaluation, cached); ≤ 78 points (≈ 5000u²) with no
  deck landing on it is drawn as the river's bank — no pavement, paint or lamp band, height untouched.
  Buildings' band is never land, so the flatten pads can't disagree. MEASURED: slivers of 64–3648u²
  before; the smallest island kept (between two decks) 7808u²; 27-size islands stay (`c1_frag_top`,
  `c1_frag26_top`).
- **Freeways that end with no deck (26, C2).** Their lane paint stops 24u short of the quay's
  centerline (in a city — the arterial tees into the quay) or of where the road yields to the river,
  unless a deck lands within 40u; the arterial median studs follow the paint. Dead-end mouths with
  paint up to the river 53 → 4 (the 4 sit beside a deck). No round cap: the road's end is the yield
  line (`c2_deadend_top`).
- **Rivers reach nearby water (28).** The high-ground rules (grade 0.2, ridge, hillside 0.15) broke
  ordinary rivers: the desert's and the snow's region bases alone exceed them. Only the RELIEF rule
  (the mountain's rock) is final now; a steep gap up to `RIVER_GAP_FILL` (800u) with river or water
  on both sides is built, and a short stretch joining water to water is kept. MEASURED (40 km
  square): gaps under 800u between stretches 159 → 54, stretch ends under 800u short of the water
  40 → 15, every one left touching the mountain's rock or a road-suppressed stretch; built pieces
  6684 → 8278, stretches 564 → 457 (`d_river_top`, `d_river2_top`). `riverBanks.test.ts` holds.
- **E: Y-shaped branched bridges.** Not removed. Round 12 removed V meets (two open ends joined at an
  angle), wedges and stubs, and shallow Ts (< 35°); a road teeing into a decked road at ≥ 35° is still
  a T-child whose deck merges into its host's (3 of the bench's 48 decks, as in round 13).

Performance (node, warm): bridges 1.33 ms per chunk median, p90 3.0, max 19 (1.33 / 2.9 / 18 before);
terrain LOD1 96×96 warm within ±2 ms at seven of eight areas (-10600,-22680: 55 → 59), cold +5–45 ms
(the fragment lattice and the wider deck lists). Client 72/72 (13 suites), server 23/23, `tsc` clean
for both.

Open after round 14:
- Two bench decks run beside a river whose surface climbs steeply along them (rivers now cross steep
  gaps): near an end the water band stands at the deck's height and the ground held over the water
  shows at its edge (the clearance counts the water band now, 1u, but samples every 8u).
- A mouth whose arterial runs along the bank into the river gets no deck (no crossing to make); its
  paint ends, its road meets the quay.
- The belts and runs get no mouth decks (a belt's own crossing either passes the rules or it drops;
  outside a city there is no mouth across to land on).
- Curb slivers (≤ 384u²) remain at a few deck edges, inside the cut's feather.

### 2.21 Round 15 (Sept 25): every freeway across a river, Y merges, waterfront belts, open deck ends

Evan's screenshots 30–42: two cities on opposite banks with no deck (30, and 31's two red lines
converging on one mouth), "maybe we need to see what it looks like if ALL freeways separated by river
are connected"; a city's edge along the water left ragged (32/33, `/amber-lakelands/sunny-lagoon`);
an inter-city run stopping at both banks (36, `/quick-concourse/famous-meadow`); a deck's parapet
walling off the road it lands on, and its side standing as a ledge over the far lanes (37/38, 41/42
`/outer-quarter/zesty-ville`). Every fix is a general rule; the links were only where to look.
Shots in the session scratchpad (`r15/shots/*_before.png` / `*_after.png`, daylight frozen).

- **Why 30/31 had no deck.** Round 14's mouths were city ARTERIALS at rivers with city on BOTH banks
  (`cityRiverOf`), so a belt corner or a run's end facing another city across a river was never a
  mouth, and the road's own deck there was dropped by the rules (a run teeing into a belt that ran
  along the shore, a belt crossing kinked at a wall junction). Spots of this kind located
  numerically (`r15/find30.ts`: every freeway mouth — arterial, segment arterial, belt, run — in a
  28 km square, and every pair of mouths of different roads facing each other across a river whose
  crossing is not city on both banks): 34 such spots.
- **Every freeway mouth** (`freewayBridges.ts` 6b, `mouthsOf` per river edge, window-free): any
  freeway's wet stretch touching the edge's footprint, its dry ends past the abutment, in a city or
  not (`edgeRoadPaths`: arterials, belts, and every run leg near the edge's pieces from each piece's
  own network). PAIRS: best-first over the candidates whose curve keeps every rule (the geometry is
  judged in the pairing now, so a failing curve no longer blocks a good pair), `MOUTH_PAIR_MAX` 700
  (was 300), chord ≤ 50° off square. BRANCHES (a Y): a mouth left over that faces a paired mouth
  across the river tees into that pair's deck — a Hermite arriving at 40/55/70° to the trunk heading
  toward the shared mouth, the junction past that mouth's ramp and, where it can, on its side of the
  centerline (so the branch itself crosses), its slab clear of the trunk's away from the junction.
  It is an ordinary T-child (trim, oblique cut, the trunk's parapet opened over it), always emitted
  with its trunk. NATURAL branches: a mouth may tee the same way into the road's OWN deck landing at
  the mouth it faces (resolved in the window, `resolveNatural`) — the case where its pair's trunk
  overlapped that deck and dropped. Mouths within `MOUTH_CLUSTER` (45u) on one bank are one road
  junction: a deck landing at one serves them all (no twin decks from one junction). LONE mouths get
  a STREET-width straight deck to the pavement across, never a freeway one; an arterial crossing is
  freeway-wide only with a freeway at both ends (`freewayDistanceAt`), else street-wide.
- **Every bridge crosses** (`mouthCurveRules` + `builtCrossingRule`): a mouth deck crosses its edge's
  BUILT centerline exactly once (a pond's end or a gap no longer counts as a crossing), no other
  river twice, every crossing at ≥ `BRIDGE_MIN_CROSSING` (40°), over one wet stretch, ≤ 45 u dry from
  a landed end, no kink, no shore. MEASURED over the 1095-chunk bench: 59 decks, every one with no T
  end crossing a river at ≥ 40° except the one pre-existing run deck at (7116, −14842) that grazes a
  river's end (runs are exempt, see Open).
- **Rivers under crossing freeways** (item 10, `riverField.ts` `roadCrossingCap`): the famous-meadow
  run's river ran along a ridge 15–17u above the valleys the road came through (the terrain there
  really is a crest), its banks held up as a levee the road climbed, and the deck needed a 43u arch
  (`clearance (arch 43.0u)`). A river piece end's surface now stands under every run and belt
  crossing the two pieces beside it by `RIVER_ROAD_CLEARANCE` (5u) below the lower landing grade —
  a pure function of the edge and the roads, per piece end, so pieces sharing an end agree. Roads,
  their cuts and grades are untouched; only the river and its banks come down there.
  `riverBanks.test.ts` holds.
- **Waterfront belts** (item 9, `cityTerrain.ts` `findWaterfrontBelt`): where a city wall running
  ALONG a river lies in its footprint (its belt's river-side curb in the water — `wallDrownedAt`,
  sampled along each wall, only walls within 30–50° of the river), the belt is carried on the
  water's straight edge instead: its river-side curb on the bank (bank + freewayWidth from the
  centerline), joined to the belt coming out of the water by a smooth minimum (`CITY_WATERFRONT_FILLET`
  30u, a rounded corner), painted as the belt (its dash phase, no second set of lanes, no lane-end
  rule — it runs along the river). The drowned belt's own half off the city yields by the STRAIGHT
  river distance too (fully sand across the footprint, ramping out over half a street past the bank,
  as the quay side does), so no strip of belt is left in the sand; rim cells beside a drowned wall are
  blocks, not all-road (the plaza with islands of 34/35).
- **Open landed ends** (item 11, `landedCut`): a landed end whose edges lie on pavement is CUT where
  its two edges leave the pavement — the end section runs between those two points at the road's own
  heights (0.05 under), through the same oblique-cut machinery as a T end — so the road simply
  continues onto the deck: no parapet over the road, no side ledge, no slab lying on the road, the
  parapets rising from where the edges leave it. The terrain cut follows that end's drawn quad
  (`bridgeCutEndTopAt`; the old flat-across line stood half a unit off the tilted cut, and the road
  showed through in shards) and the cover respects the oblique cut (`bridgeWithinEnds`). Landed ends
  that are not cut keep their ramp, now long enough to cover any edge still over pavement; parapets
  there open wherever they stand over pavement; pier columns reach the DRAWN underside (they stuck up
  out of the bank under a ramp). MEASURED (`r15/ledge.ts`, bench decks): deck edge points over road
  pavement within 35% of a landed end standing > 0.1u above the road 576 of 774 (all 48 decks) → 82 of
  186 (14 decks, mostly decks that follow their own road for over a third of their length and so get
  no cut); parapet points over pavement 619 → 85.
- **Determinism**: landed ends and mouths are found from the samples beside them alone (an arc length
  summed from a path's start rounded differently where a window clipped the path). Forward, reverse
  and shuffled chunk orders agree bit for bit over 580 chunks (61 decks, one owner each); a window
  forced to 3200 differs at one chunk by 4e-12 — as the round-14 code does at that chunk.

MEASURED (28 km square): 30-like spots with every mouth bridged 13 → 23 of 34; freeway mouths
bridged 194 → 250 of 409 (dead ends 201 → 142: belts 131 → 90, runs 13 → 5); road×river crossings
(a road's own wet stretch bank to bank) decked 70 → 77 of 82 — the 5 left: a belt kinked 86° at a
wall junction, a belt and two arterials along the shore, one arterial at 38°. The 1095-chunk bench
48 → 59 decks (freeway 39 → 46, street 9 → 13). No street lamp on a deck (3507 lamps).

Performance (node, warm): bridges 1.43 ms per chunk median, p90 4.1, max 23 (1.37 / 3.1 / 19 before);
merging and the wider pairing cost ~0.06 ms median, the tail mostly natural branches resolving
against decks built in the window. Terrain LOD1 96×96 warm +1–9 ms at ten areas (e.g. 45 → 54,
56 → 60, 59 → 65), the waterfront belt test at city vertices beside rivers and the belt's straight
river distance off the city; cold +20–150 ms. Client 77/77 (14 suites), server 23/23, `tsc` clean
for both. New `bridgeRules.test.ts`: every deck crosses at ≥ 40° (a T-child with its host), a
freeway-wide deck has freeway at both ends, a Y has no wall inside the other deck and no slab over it
past the cut, and a landed end is flush wherever an edge lies over pavement.

Tried and rejected this round: a road PAD at landed ends (the deck lying ON its road, fitted station
by station, parapets opened over pavement) — Evan's 39/40: chopped asphalt where slab and road fought
over one surface, a parapet lying on the ground, piers standing on land, a different shade; cutting
the end at the pavement's edge replaced it. The waterfront as a WIDENED QUAY (street → freeway lerp
beside a drowned belt) — 34/35: two sets of dashes wandering across each other, all-road rim cells as a
plaza, a staircase corner; it is the belt carried along the water now. A drowned test by
"belt distance minus river distance" — true beside every belt that CROSSES a river (its closest point
lies in the channel), which turned interior city quays into freeways; walls must run along the river.
Natural branches only for mouths no pair took — lost the Y merges whose pair's trunk overlapped the
road's own deck.

Open after round 15:
- The run deck at (7116, −14842) grazes a river's end without crossing it (runs are exempt from the
  crossing rule so a run is never drowned); Evan's rule 4 says every deck must cross — dropping it
  would leave the run in the water there.
- Mouths facing each other across a CONFLUENCE (two river edges) are not paired (pairs are per edge);
  the SW corner at (10300, −1950) is one.
- A deck following its own road for over a third of its length keeps its ramp (no cut) and can still
  stand over pavement along that road.
- A small block island can remain between a waterfront and a street near the corner (sunny-lagoon's
  north-east); the NE corner where the waterfront meets a belt along the lake has a pointed sidewalk
  tip.
- Landed-end appearance at night (40): the deck's shade vs the road's was not re-matched; with the
  cut the deck no longer lies over the road, which removes most of the mismatched area.

### 2.22 Round 16 (Sept 26): no freeway severed, seamless landed cuts, nothing through a deck

Evan's 43–50. THE INVARIANT: no freeway connection (inter-city run, belt, city arterial) is cut by
water — a deck joins the two sides, or the river gives way ("the road wins").

Causes at the two example spots:
- **43 (/outer-quarter/hazel-ville, ~6030,1140)**: the lower city's belt wall crosses the river at 30°
  (drowned — the waterfront carries it along the bank); the next wall crosses at 49° from the corner
  on the upper bank and turns 90° in the water, so its chain dropped ("along the shore", "kinked"), and
  the inter-city run ending at that corner was STRANDED: its only way on was the drowned belt.
  Fixed by `strandedRunEnds` (a run end whose corner's belts all hit water within 40u gets a mouth of
  its own): a curved freeway deck now carries the run from the corner across to the lower city.
- **44 (/golden-hoarlands/zonal-dome, ~10250,−1840)**: a pond END (at a blocked/suppressed piece) sat
  under the run, which kinked 72° through it. Fixed by the RETRACTION: a river end under a run's or
  belt's centerline retracts piece by piece (the river ends short; the run stays dry).

Rules built (riverNetwork.ts `riverEdgeRoadLayer`, rewritten as a set of small functions; freewayBridges.ts):
- The road layer judges every wet road stretch by the bridges' rules (odd crossings, ≥ 40°, ≤ 60u
  along the shore, ≤ 45° turn after rounding); an undeckable one (shallow; belt/run along the shore;
  belt/run ending in the water with nothing to tee into) gives the river way, repeated until stable.
  Grazes, stretches beside a deckable one, waterfront belts and quay arterials keep their river.
- No river end under a road: natural ends, unbuilt land, gaps the road won — also a gap running on to
  the edge's end (it was read as "the river continues at the junction": a pond end pinched a belt
  corner to a sliver at −17377,11627) — and junction ends ≤ 2 pieces retract while a run/belt lies in
  the end piece's footprint. Removed pieces 277 → 358 of 3891 (+2%).
- Bridges: stranded run mouths; `smoothKink` (a kinked both-landed chain tried as one Hermite curve);
  freeway-width lone-mouth decks where both ends are freeway; clearance at the centerline and both
  edges; a T end off its host's rounded corner is extended onto the host (`extendOntoRoundedHost`:
  the run at 23400,−4314 ended against a deck's parapet); straight crossings may run ≤ 60u along the
  shore (`straightAlongShore`: a 462u fill deck two thirds over the sand at −18051,−8804).
  `MOUTH_PAIR_TURN` 50° kept — 65° (tried) paired belt corners with belts along the far bank and
  laid the deck's approach over (and cut) that belt: spot −18058,−8511 and three bench decks.
- Seamless landed cut (45–48): the end section sits at the ASPHALT height of its corners; in front of
  it the road is the cut's own cross-fall at the centerline's pitch (flush + 0.05); the MOUTH region
  (12u in front, the deck's width + 3u) is asphalt at that height, the curb removed; the cut's
  cross-fall eases into the deck's own over `BRIDGE_CUT_TWIST` = 12u (the next section was flat: on a
  hillside road at 5666,1474 the slab's edge dropped 3u within a unit of the cut); the ground under
  the first 6u (`BRIDGE_CUT_SEAM`) follows the slab's own top; paint-off never in a mouth.
- Nothing through a deck (49): the cut follows the DRAWN slab (sections inverted by Newton; per-quad
  bounding circles keep it cheap), with margin = vertex spacing × √2 + 0.5 per LOD
  (`setDeckCutSpacing` in the terrain worker; LOD1 elsewhere, so the server's heightfields match the
  player's). The overlap deck query missed lone-mouth decks whose far end lay outside their loose box
  (the ground under −15999,10513's end was never cut) — pre-filtered by box + 0.7 × MOUTH_PAIR_MAX.
- Give-way edges (50): smooth maximum for the river's push on the road field, the straight push ramped
  over ≥ 9u, faded in off an undrowned city wall.

CENSUSES (scratchpad probes; "before" = the round-15 tree):
- Severed freeways, 28 km square (−14000..14000): **8 → 0** (122 stretches quay-carried). West box
  (−42000..−14000): **15 → 0**. Held-out east box (14000..42000): **10 → 4**, each justified: 20719,−5872
  and 39547,−5208 are connected through a deck 440u / 250u away (beyond the census's 320u paved
  reach — at 520u they pass); 27421,1168 is an arterial segment ending on the quay that carries it;
  40268,−1209 is a 16u run stub inside the belt's continuous pavement.
- Landed cut seams (100 ends, 2720 points, 0.1u in front of the cut): step **1511 → 2**, curb
  **1583 → 0**, sliver **134 → 0**, terrain over the slab behind the cut **33 → 0**. (At 0.75u, 242
  "steps" remain: the road there continues the deck's pitch, as designed — no discontinuity.)
- Terrain above the drawn top (58 decks, 516k slab points, flush seam excluded): LOD1 **2254 → 67**
  (worst +2.91 → +0.68), LOD2 **3668 → 47** (+3.24 → +0.49). The rest are sub-unit interpolation
  pokes at slab edges beside landed ends and one low edge near 5666,1474 held at the water.
- Give-way jumps (LOD1 vertex pairs going asphalt → past the sidewalk within one spacing, near rivers,
  11 areas): **537 → 391**; spot 50: 7 → 3. NOT zero: the rest are where the WATERFRONT belt's own
  field (city side) meets the river's push on the belt's outer half, and the city's quay river side
  switches from road to its own field within 3.5u — both need the city side's field at the wall to
  be continuous with the push (tried a cap from an approximated city field at the wall: no change —
  the approximation disagreed with the real city field there).

Performance: bridges per chunk (1095-chunk bench, warm) median 1.46 → 1.41 ms, p90 3.9 → 4.1; decks
59 → 53, none gained — the six lost (−10602,10313, −10288,9564, 3086,11072, −19662,15894, 7057,−15322 and
the round-15 run deck at 7116,−14842 that grazed a river end) are all rivers that now end short of the
road (retracted ends / removed pieces), the census clean around each. Terrain LOD1 96×96
warm within noise except the densest city-river area (62 → 68 ms); COLD first entry +100–450 ms at
the bridge areas (the road layer builds each edge's road paths, which pull the freeway network along
the whole edge — `routeCityPairs`/`buildNetGraph` doubled). Determinism: forward, reverse and
shuffled chunk orders identical (755 chunks, 79 decks, one owner each, terrain height hash equal);
a window forced to 3200 differs at one chunk by ~1e-12. Client 80/80 (15 suites; new
`severedFreeways.test.ts`), server 23/23, `tsc` clean for both.

Rejected this round: removing the river under every GRAZE (took whole river mouths and 14 of 59 bench
decks); a kink-based removal rule (lost 4–9 decks); splitting bridge paths at carried stretches
(`withoutCarriedStretches` in the bridge pipeline dropped working decks — it lives in the census only);
`MOUTH_PAIR_TURN` 65°; a centerline-extrapolated flush (tilted the road in front of every cut by the
next section's cross-fall); a 24u twist (dipped a low deck edge under the water); a lone-mouth box of
the full MOUTH_PAIR_MAX (bridges p90 4 → 13 ms); a continuous (bilinear) fragment weight and a wider
straight ramp for image 50 (no measurable effect — the jag is not a fragment edge).

Open after round 16:
- Give-way staircases where a waterfront/quay meets the belt's outer half (391 LOD1 jumps over 11
  areas, 3 at spot 50).
- Cold first-entry cost of the road layer near rivers (+0.1–0.45 s per LOD1 chunk timing).
- The census's paved reach (320u) flags two connections served by a farther deck.

### 2.23 Round 17 (Sept 29): nothing raised over pavement, exact triangle cut, rounded corners and crotches, flat freeways at walls

Evan's 51–60 ("we're getting really close to perfect here!").

1. **No parapet or raised edge over pavement (51, 52).** Cause: a landed cut was placed where the
   deck's edges FIRST left the pavement, and the parapet gaps were scanned only over ramps, so a deck
   landing at a slant kept its slab edge and parapet over the road's side / sidewalk past that point.
   Fix: one definition of pavement (`pavedAt`: asphalt + curb, and the sidewalk in a city; nothing
   within the river's half-width + 8), used by the cut (`landedCut`: where each edge leaves it for the
   LAST time within 35% of the deck, lateral positions on the mitered axes), the ramp length
   (`landingOf`) and the parapet gaps (the WHOLE deck scanned every 2u, bisected). A road's own chain
   whose last-exit cut then fails clearance or sinks is rebuilt with the first-exit cut, then uncut
   (`withCutRetry`; not synthesized crossings — a retried mouth deck rode 54u over its road). Census
   (bench, 57–58 decks): ledges over pavement **503 → 1** (curb-only 228 → 1), parapet points over
   pavement **1303 → 0**.
2. **Terrain never through a deck, on the TRIANGLES (53).** Cause: the cut capped each VERTEX at the
   slab top, but a mesh triangle between vertices under a non-planar slab (a cut's cross-fall easing
   into the deck's, an arch) rose through it. Fix: the drawn slab is modeled as the ribbon's exact
   triangles (`drawnOf`), and `bridgeTriangleCap` lowers each lattice vertex by the worst rise any of
   its six terrain triangles makes over the slab inside it (Sutherland–Hodgman clip against each slab
   triangle — exact, and nothing is over-cut where the slab is planar); between lattice points the
   caps are interpolated like the mesh. The overlap deck query now finishes its decks, so the terrain
   cuts the same sections the ribbon draws; the water is hidden at vertices under a low slab. Refs and
   triangle rises are cached per deck and lattice (uncached, the cap was half an LOD1 chunk's build).
   Census (rendered LOD mesh vs rendered slab, 2.6M points): LOD1 **67 → 0**, LOD2 **47 → 0**; landed
   seam steps at 0.1u **287 → 10**, "under" 13 → 0.
3. **Rounded give-way corners (54, 56, the 50 staircase).** Cause: a run's river push was a steep
   straight ramp and the belt's outer half gave way on its own rule, so where the city's quay river
   side, the belt and a run met the field switched rules within a few units — a pointed tip, and the
   staircase of 50. Fix: the run's push is linear (`13·(yield − d)/ROAD_RIVER_RAMP`, ramp 16, capped
   40) smooth-maxed into the field; the belt gives way with the SAME function as the city's quay river
   side; the belt/run blend is by share. Census: give-way jumps 224 → 182 off-deck; pointed corners
   (morphological opening R 7 / 5 near sand) **21 → 14 / 7 → 5** — the rest are narrow (≤ 15u) roads
   and city block tips, not give-way edges.
4. **Filleted T/Y crotches (57, 58).** Cause: a child deck's trimmed end met its host's edge in a
   hard point. Fix: `crotchFlares` — per T end and side a fillet (radius 6 acute, 4 obtuse) tangent to
   the child's edge and the host's; the child's sections widen per side (`BridgeSection.wl/wr`) to
   follow it, extra flare stations are added, the host's wall opens over the fillet (`crotchRings`)
   and the colliders follow: base strips over the shared width plus 1u flare strips. Census: sharp
   crotches (equivalent radius < 4) **10 → 0 of 14**.
5. **Freeway height step at biome/region walls (59, 60).** Cause: the grade under a freeway was the
   blended terrain at its centerline point under the VERTEX's own zone weights, so on or across a
   wall (runs ARE walls) the two halves of the road rose to different grades — a crease down the
   middle. Fix: the grade is a pure function of the centerline (`freewayGradeAt`): the terrain at the
   centerline point with ITS OWN wall pass (`terrainOnlyAt`), on a cached 8u lattice per segment,
   smoothed along the run (5 taps, reflected past its ends), blended over nearby segments by distance
   and over one run's legs by arc, with the warp's shear corrected so a cross-section is square in the
   world. Inside the city an arterial/belt is flat across its lanes (`CITY_FREEWAY_RAMP_START` 14 → end
   34). Steep grades and cuts are untouched. Census (asphalt cross-sections ±12u every 8u): at walls
   tilt > 0.5u **1636 → 91**, crease > 0.3u **1100 → 195**, big (> 1.5 / > 1) **1092 → 18**; belt
   outer half tilt **3385 → 103**; LOD1 lattice creases **2628 → 759** (> 1u 960 → 138). What remains
   twists through sharp bends of steep runs.

Also: severed freeways **0 / 0 / 4** in the three boxes (unchanged; the east box's four are round
16's); the census's pavement is now `pavedAt` (a city sidewalk a cut end lands on is pavement).
Max deck pitch 33% → 23%.

Performance: bridges per chunk (1095-chunk bench, warm) median 1.21 → 1.21 ms, p90 3.4 → 4.1. Terrain
LOD1 96×96 warm within ~10 ms of round 16 at the ten spots (worst 229,2912: 39 → 50 ms); first entry
+20–130 ms at bridge areas (finished overlap decks, the cut retry). Determinism: forward, reverse and
shuffled identical (755 chunks, 79 decks, one owner each, height hash equal) — the grade lattice's key
was `toFixed(3)` and made that order-dependent at 1e-12; it is exact now. Client 85/85 (16 suites; new
`deckGround.test.ts`), server 23/23, `tsc` clean for both.

Rejected this round: a pad-based planar cut end and an eased arch (both steepened pitches); raising a
deck's camber to clear the drawn water (two decks 39–44% steep — the water is hidden under a low slab
instead); a pavement edge pad (more ledges); a min()-based belt field (a phantom quay road off the
city); retrying synthesized crossings with the first-exit cut.

## 3. Tried and rejected this round

- **One Dijkstra per source city instead of one per pair** (Round 11). Not exact: the heap orders
  node indices by the LIVE `dist[]`, so a decrease-key re-push leaves a stale entry whose key has
  already changed inside the heap — the pop order depends on the heap's contents, and a search that
  also pushes the other cities' junctions popped a different first junction of the target (2 of 916
  walls moved in the 50 km test square). It also measured no faster over 10,000 windows. A proper
  keyed heap would be correct Dijkstra, but it moves roads — a decision, not an optimization.

- Angle-based bridge span (above). Per-cell lake level (above). Freeway paint inside a biome
  frag (above). Mountain `blendWidth` 450 / noise 900×900 (above).
- Keeping a `Dimension` level with regions inside: nothing it did (base noise, sky, blend
  widths) needed a third grid once regions own them.

## 4. Open / next round

Round 11 proposals (work that makes few or no pixels, NOT built because each changes something
visible or needs a decision; gains MEASURED in node unless marked):
- **No river field at LOD4–5** (3360–8400u): startup ring 2749 → 2426 ms (−12%; with LOD3 too,
  2284, −17%). Cost: in that ring 33 of 630 LOD4 vertices and 2 of 28 LOD5 vertices sit in a river
  footprint (12 under water) — those far water specks and dents vanish (LOD3: 67 of 1675, 39 wet,
  at 1680–3360u — more visible). Skirts (160/260/400) cover a river's depth at any far seam.
- **Build a building's INTERIOR on approach, not at spawn**: the interior phase is 0.92 ms of
  1.58 (building) / 1.42 of 2.32 ms (skyscraper), 58–61% of the build, and 61 KB of geometry
  (1736 vertices; the exterior is 46 KB) — built for every building within 625u, drawn only within
  150u, its colliders only within 120u. Hundreds mounted in a city ≈ 0.3–0.8 s of sliced
  main-thread work and ~18–36 MB of JS heap never drawn (estimate from those per-building numbers).
  Needs a second asset stage and the detail colliders gated on it; a very fast approach could see a
  hollow interior for a frame or two. Not measurable headless.
- **Road markers to ~200u instead of 340u**: a 0.16u stud is under a pixel tall past ~150u at
  1080p/75° vertical FOV; ~half the marker chunks and worker enumerations. Visible: fewer
  sub-pixel sparkles on distant roads.
- **Server building hulls only near NPCs**: every registered building (all within 625u of a player)
  gets a hull (~0.3–0.5 ms plan + hull each), NPCs live within ~243u. Not measured on the server;
  needs a proximity rule so an NPC never meets an unbuilt hull.
- **Foliage: generate only the instances that survive the fade** for far chunks (past the taper
  75% of a chunk's blades are generated, sorted, transferred and uploaded but never drawn); the
  catch is regenerating on approach.
- **LOD2 skirt 80 → ~100u**: the pre-existing LOD2→3 gap reaches 78.8u along four map-spanning
  lines (unrelated to this round) — no margin left.

- **Freeway paint exists only through the terrain material; the deck is a lit mesh.** The deck
  reads darker than the road in shadowless daylight (0x3b3b41 vertex color); lane paint on the
  deck would need a small shader or a second instanced strip.
- **Runs across lakes**: a run between two cities that crosses a lake cell simply dives (step 5
  skips water zones; lake walls carry no river, so no bridge). Rare — cities are in the city
  region, lakes in the ocean region — but real. Needs either a lake bridge or a relay rule.
- **Attached deck ends** take the host deck's height at the point, but a segment arterial whose
  row deck was dropped has nothing to attach to and gets no deck (its road ends at the bank).
- **End-to-end CYCLES of decks** (two short runs between the same two hubs, both wholly inside a
  wide river) are dropped with their T-children (`bridgeDebug.drops` says "cycle"): rare, seen once.
- **Grass grows on the sand banks** (foliage keys on the biome weight, not the bed paint).
- **The quay road has no raised markers** (markers enumerate grid lines and lattices, the quay
  follows the river) and no traffic signals where streets tee into it.
- **Freeways cross only what the run crosses**: no paint variants per region (asphalt on snow
  looks the same as on grass — fine — but the grade ignores the mountain's presence ramp).
- **Swimming / water physics**; water sound; river flow direction in the shader (the surface
  scrolls uniformly).
- **Lake bodies are big**: joinable lake cells on a 500u grid make the ocean region a sea. If
  discrete lakes are wanted, make the lake biome non-joinable or add a dry "shore" biome.
- The CRT thumbnail still shows the old 3-biome diorama on page 1 only.
- Two runs from one city can leave nearly parallel and cross the same river 40u apart — two
  decks side by side (screenshot at the first bridge). A minimum angular separation between
  runs from one site would merge them.

---

## 5. File moves (Sept 29 organize pass) — for the paths named above

Structure only (every generated output byte-identical, `dump.tmpl.ts` hashes). Old → new, under
`src/utils/workers/` unless noted:
- `freewayBridges.ts` (5100 lines) → `bridges/`: `freewayBridges.ts` (entry, windows, `bridgeDebug`),
  `roadPaths.ts`, `wetItems.ts`, `rules.ts`, `landings.ts`, `deckBuilder.ts`, `finishDeck.ts`,
  `crossings.ts` ("section 6"), `mouths.ts` ("6b"), `deckGeometry.ts`, `drawnSlab.ts`,
  `severed.ts` (`getSeveredFreeways`), `polyline.ts`, `constants.ts`, `types.ts`.
- From `vertexCompute.ts`: the freeway grade → `roads/freewayGrade.ts`; the ground cut under decks
  (step 7) → `bridges/deckGround.ts`; the road-fragment flood fill (step 8) → `roads/roadFragments.ts`;
  `getBiomeContext` → `voronoi.ts`; `networkOf` → `roads/freewayNetwork.ts`.
- `riverNetwork.ts`, `riverField.ts` → `rivers/`; the road layer → `rivers/riverRoadLayer.ts`.
- `freewayNetwork.ts`, `cityTerrain.ts`, `cityFeatures.ts` → `roads/`.
- Tests: `riverBanks.test.ts`, `riverRoads.test.ts` → `rivers/`; `cityFeatures.test.ts` → `roads/`;
  `bridgeRules.test.ts`, `deckGround.test.ts`, `severedFreeways.test.ts` → `bridges/`.
- `densityPlacement.ts` → `densityGrid.ts`; `buildDomainConfig.ts` → `src/world/domains/`.
- Removed: `cityBeltRadius` (always 0: the belt is centered on the wall), `debugMouthGeoms`, the
  `TERRAIN_POINT_LIGHTS` flag (always on), `GRASS_BIOME_ID` / `LAKE_BIOME_ID` (use the specs' ids).
