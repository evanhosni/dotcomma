# Game objects

## How it works

Everything placed in the world that is not terrain, water or sky is a game object, and each belongs to one of three classes. Each class has a **base** that owns all shared logic (camera-distance lifecycle, world curvature, spawn fade, GPU warm-up, disposal); a member writes only what is unique to it.

| class | for | base |
|---|---|---|
| [Actor](actors/README.md) | own identity, state or interaction: NPCs, buildings, clickable props | [actors/index.tsx](actors/index.tsx) |
| [Dressing](dressing/README.md) | mass, identical, stateless scenery: lamps, markers, signals, poles, bridges | [dressing/index.tsx](dressing/index.tsx) |
| [Foliage](foliage/README.md) | vegetation in the thousands per chunk: grass | [foliage/index.tsx](foliage/index.tsx) |

- **Attributes** ([types.ts](types.ts)): `GameObjectAttributes` (every class: distances, quantization, `serverSynced`, placement filters, `density`, `footprint`) → `ActorAttributes` / `DressingAttributes` / `FoliageAttributes`. Member-only attributes live next to the member (`ModelActorAttributes`, `BuildingAttributes`). A field lives at the highest level at least two members share.
- **Mounting is placing**: every object is a component mounted inside the `<Biome>` it belongs to — `<Actor actor={SPEC}/>`, `<StreetLamps/>`, `<GrassField/>`. Its knobs are its props; there are no group wrappers and no defaults layer between the two.
- **Placement** is deterministic and off-thread: spawn.worker, dressing.worker and foliage.worker in [../utils/workers/](../utils/workers/). Same seed, same points, on every client and the server.
- **Shared parts**: [geometry.ts](geometry.ts) (`bakeVertexColor`, `mergeOrThrow`: vertex-colored parts merged into one mesh, for buildings, doors and the tunnels' fittings) and [doors/](doors/README.md), THE hinged door.
- **Sync**: only actors are server-synced; dressing and foliage are deterministic scenery.

## How to add another

1. Pick the class: unique geometry/interaction/behavior → actor; many identical stateless copies → dressing; thousands-per-chunk vegetation → foliage.
2. Follow that class's README.
3. A new shared attribute goes into [types.ts](types.ts) at the highest level that fits; a new world-wide effect goes into the class base, never one member.
