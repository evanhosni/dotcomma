# The declarations

## How it works

The components a world is written with. Each is a `declare(...)` from [content/](../content/): it
carries what the walker reads and what React draws, so mounting one is the whole fact.

| component | where | what it means |
|---|---|---|
| `<Domain terrain background playerSpawn>` | the root | ONE world. Walks its children, publishes the config, mounts the systems and every `Driver` the tree asked for. |
| `<Region id name blendWidth>` | in a domain | a group of biomes on one base terrain, look and sky. Its order among its siblings is VORONOI order. |
| `<Biome id name joinable blendWidth>` | in a region | one voronoi zone. Everything true of it is a child. |
| `<Terrain seed gridSize …>` | in a domain | its global terrain knobs over [defaults.ts](../defaults.ts). |
| `<Noise params absNeg scale offset>` | in a region or biome | its relief. `<Dome>` and `<Detail>` go inside it. |
| `<Dome height reach noiseFloor>` | in a noise | the ground rises with the square of the depth inside the biome: a joined group is ONE massif. A domed biome is ROCK. |
| `<Detail …>` | in a noise | a layer added at every depth, so a dome's foot keeps it. |
| `<Water depth>` | in a biome | a lake: the terrain bowls under a filled surface, and no freeway runs along its walls. |
| `<Rivers chance>` | in a region | rivers under it. No `<Rivers/>`, no rivers — they run on their own grid, so no biome can own one. |
| `<Material shader textures getMaterial riverbed riverTexture>` | domain, region or biome | its LOOK. Under a domain the default riverbed texture, under a region the BASE material, under a biome its fragment shader. |
| `<Skybox topColor horizonColor bottomColor radius>` | domain, region or biome | its sky. Region skies MIX by position across region edges; a biome's wins while the player is in it. |
| `<Actor actor={SPEC} …overrides>` | in a biome, or inside a feature | what spawns. In a biome the density field places it; inside a feature, that feature does, one per part. Mounting it is also what CATALOGS the kind for the server. |

Everything else a biome can hold — `<Snow/>`, `<Rocks/>`, `<Sewers>`, `<Caves>`, `<StreetLamps/>`,
`<GrassField/>`, `<LakeBubbles/>` … — is declared in its own system's folder under
[objects/](../../objects/), because that is where its code lives.

### Hazards

- `<Region>` and `<Biome>` children are in VORONOI order. Appending or reordering one re-rolls every
  cell of that grid and MOVES EVERY ADDRESS.
- A content file exports a static element through `content(...)`, never a function. See
  [content/README.md](../content/README.md).
- Ids and names must be unique within a domain; names are lowercase letters only (they are address
  words and shader function names). Asserted at the commit.

## How to add one

A new declaration belongs in the folder of the system it turns on, not here — here is only what
every world is built from. See [content/README.md](../content/README.md) → "How to add a declaration".
