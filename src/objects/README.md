# Game objects

## How it works

Everything placed in the world that is not terrain, water or sky is a game object, and each belongs to one of three classes. Each class has a **base** that owns all shared logic (camera-distance lifecycle, world curvature, spawn fade, GPU warm-up, disposal); a member writes only what is unique to it.

| class | for | base |
|---|---|---|
| [Actor](actors/README.md) | own identity, state or interaction: NPCs, buildings, clickable props | [actors/Actor.tsx](actors/Actor.tsx) |
| [Dressing](dressing/README.md) | mass, identical, stateless scenery: lamps, markers, signals, poles, bridges | [dressing/Dressing.tsx](dressing/Dressing.tsx) |
| [Foliage](foliage/README.md) | vegetation in the thousands per chunk: grass | [foliage/Foliage.tsx](foliage/Foliage.tsx) |

- **Attributes** ([types.ts](types.ts)): `GameObjectAttributes` (every class: distances, quantization, `serverSynced`, placement filters, `density`, `footprint`) → `ActorAttributes` / `DressingAttributes` / `FoliageAttributes`. Member-only attributes live next to the member (`ModelActorAttributes`, `BuildingAttributes`). A field lives at the highest level at least two members share.
- **Group defaults**: objects mount inside `<Actors>`, `<Dressing>` or `<Foliage>` in a biome; group props are defaults, a child's own props win. `<Dressing>`/`<Foliage>` come from `createDefaultsGroup` ([utils.tsx](utils.tsx)).
- **Placement** is deterministic and off-thread: spawn.worker, dressing.worker and foliage.worker in [../utils/workers/](../utils/workers/). Same seed, same points, on every client and the server.
- **Sync**: only actors are server-synced; dressing and foliage are deterministic scenery.

## How to add another

1. Pick the class: unique geometry/interaction/behavior → actor; many identical stateless copies → dressing; thousands-per-chunk vegetation → foliage.
2. Follow that class's README.
3. A new shared attribute goes into [types.ts](types.ts) at the highest level that fits; a new world-wide effect goes into the class base, never one member.
