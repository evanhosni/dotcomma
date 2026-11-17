# The declarations

## How it works

The components a world is written with. Each is a `declare(...)` from [content/](../content): it
carries what the walker reads and what React draws, so mounting one is the whole fact.

| component | where | what it means |
|---|---|---|
| `<Domain playerSpawn>` | the root | ONE world. Walks its children, publishes the config, mounts the systems and every `Driver` the tree asked for. |
| `<Region id name blendWidth>` | in a domain | a group of biomes on one base terrain, look and sky. Its order among its siblings is VORONOI order. |
| `<Biome id name joinable weight blendWidth>` | in a region | one voronoi zone. Everything true of it is a child. `weight` (default 1) is its share of its region's biome roll. Two joinable biomes with the same `<Noise>` literal are one RELIEF: no wall between them fades it to the base. |
| `<Terrain seed gridSize …>` | in a domain | its global terrain knobs over [defaults.ts](../defaults.ts). |
| `<Noise params absNeg scale offset>` | in a region or biome | its relief. `<Dome>` and `<Detail>` go inside it. |
| `<Dome height reach noiseFloor>` | in a noise | the ground rises with the square of the depth inside the biome: a joined group is ONE massif. |
| `<Detail …>` | in a noise | a layer added at every depth, so a dome's foot keeps it. |
| `<Water fallGrade defaults>` | in a domain | THE BASE of all water: what every body shares (one mesh, material, bed shade, depth rule, what a fall is), and every body kind's domain-wide defaults (`defaults={{ rivers: {…}, lake: {…}, pond: {…} }}`). Its children follow every water, whatever body it is (`<WaterfallBoulders/>`, `<WaterfallSplashes/>`). No `<Water>`, no water. |
| `<Lake depth levelBelow levelBelowLand landGrade bedBumps shoreHold shoreFade riverWidening …>` | in a biome | a BODY of water, area-shaped: the biome IS water — its terrain bowls under a filled level, and no freeway runs along its walls. Every body is declared on ONE base (`world/components/water/Water.tsx` `declareWaterBody`) and takes the same children as its PARTS — `<Actor>`s, `<Banks/>`, foliage, particles — each standing in its `zone` of the water the body owns ([water/README.md](../water/README.md)). |
| `<Rivers chance width depth wallGrade wallEase wallReach maxGrade maxRidge maxCrossGrade minStretch gapFill maxCarve shortGap summitMaxGap>` | in a region or a biome | rivers there. In a region: every biome under it (no `<Rivers/>`, no rivers). In a biome: overrides its region's prop by prop — an edge is kept at the chance of the biome under its midpoint, and `chance={0}` is DRY (`PIECE_DRY`: no piece is built in it; a stretch reaching it ends at its wall like any natural end); without a `chance` a biome keeps its region's (mounted for its parts alone: the mountain's `<Banks/>`). Its gap rules judge each edge by the biome under its midpoint. Rivers run on their own grid and cross every wall. A BODY of water, line-shaped. |
| `<Pond kind={SPEC} riverEnd midRiver summit standalone chance radius blob wallGrade wallEase wallReach minRadiusOverRiver calmGrade summitStream shallowColor deepColor deepDepth>` | in a region or a biome | POINT water of a kind (a Three-free `PondSpec`: `domains/overworld/water/spec.ts`), a chance per opportunity (0–1) of each placement mode (a river's natural end — a miss ends it round —, a calm slot mid-river, the summit of a gap it climbs, a standalone cell; `chance` sets every mode it does not name). Several kinds share a biome, their chances summed in JSX order; a biome's mount of a kind replaces its region's whole (a body's `id`, `pond:<kind>`; `chance={0}` turns it off there). A BODY of water, point-shaped. |
| `<Banks share fineScale fineShare dropStart dropFull dropScale dropCap>` | in a `<Rivers>` or a `<Pond>` | the channel's levee takes its biome's own noise as relief ([water/README.md](../water/README.md)). |
| `<Quays/>` | in a biome | the biome keeps its own river banks (its own height code walls them: only the city's does): no walls, bed limit or merge there, a river beside it at a lake held to the lake's level. |
| `<Material shader textures getMaterial riverbed riverTexture>` | domain, region or biome | its LOOK. Under a domain the default riverbed texture, under a region the BASE material, under a biome its fragment shader (none: the biome draws its region's base). |
| `<Skybox topColor horizonColor bottomColor radius>` | domain, region or biome | its sky. Region skies MIX by position across region edges; a biome's wins while the player is in it. |
| `<Actor actor={SPEC} …overrides>` | in a biome, or inside a feature | what spawns. In a biome the density field places it; inside a feature, that feature does, one per part. Mounting it is also what CATALOGS the kind for the server. |

Everything else a biome can hold — `<Snow/>`, `<Rocks/>`, `<Sewers>`, `<Caves>`, `<StreetLamps/>`,
`<GrassField/>` … — and every part of a body of water (`<WaterBubbles/>`) is declared in its own system's folder under
[objects/](../../objects), because that is where its code lives.

### Hazards

- `<Region>` and `<Biome>` children are in VORONOI order. Appending or reordering one (or changing a
  `weight`) re-rolls cells of that grid and MOVES ADDRESSES.
- A content file exports a static element through `content(...)`, never a function. See
  [content/README.md](../content/README.md).
- Ids and names must be unique within a domain; names are lowercase letters only (they are address
  words and shader function names). Asserted at the commit.

## How to add one

A new declaration belongs in the folder of the system it turns on, not here — here is only what
every world is built from. See [content/README.md](../content/README.md) → "How to add a declaration".
