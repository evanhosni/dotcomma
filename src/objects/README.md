# Game objects

## How it works

Everything placed in the world that is not terrain, water or sky is a **game object**, and every game object belongs to exactly one of three classes. Each class has a **base** that owns all the logic its members share (the camera-distance lifecycle, world curvature, the spawn fade-in, GPU warm-up, disposal). A member only writes what is unique to it.

| class | use it for | base | README |
|---|---|---|---|
| **Actor** | objects with their own identity, state or interaction: NPCs, buildings, props you can click | [actors/Actor.tsx](actors/Actor.tsx) | [actors/README.md](actors/README.md) |
| **Dressing** | mass, identical, stateless scenery: street lamps, road markers, traffic lights, power lines, bridges | [dressing/Dressing.tsx](dressing/Dressing.tsx) | [dressing/README.md](dressing/README.md) |
| **Foliage** | vegetation at tens of thousands per chunk: grass | [foliage/Foliage.tsx](foliage/Foliage.tsx) | [foliage/README.md](foliage/README.md) |

Rule of thumb: unique geometry, interaction or behavior makes it an actor. Many copies that are identical and stateless make it dressing. Thousands per chunk of vegetation make it foliage. Picking the wrong class costs performance: lamps built as actors cost 10–20 fps.

**The attribute hierarchy** ([types.ts](types.ts)). Every knob an object accepts is declared in one tree:

```
GameObjectAttributes      every class: renderDistance, colliderDistance, quantization, serverSynced,
│                         placement filters (biomeIds, heightRange, slopeRange, roadDistanceRange),
│                         density, footprint
├─ ActorAttributes        clustering, priority, spacingOverrides, despawnDistance, immediateRadius,
│  │                      frustumPadding, cursorOverride, flattenGround/Radius/Skirt
│  ├─ ModelActorAttributes   (actors/ModelActor.tsx) model, scale, collider options
│  └─ BuildingAttributes     (actors/building/types.ts) shell, window and interior knobs
├─ DressingAttributes     empty today: each feature adds its own placement props
└─ FoliageAttributes      slopeBlend, color, png/texture, width, height, sway, swaySpeed, seed
```

A field lives at the highest level where at least two members use it. Member-only fields live next to the member.

**Group defaults.** In a biome, objects are mounted inside a group component: `<Actors>`, `<Dressing>` or `<Foliage>`. Props on the group are defaults for every child, and a child's own props win. `<Dressing>` and `<Foliage>` come from `createDefaultsGroup` in [utils.tsx](utils.tsx). `<Actors>` lives in [../world/components/Actor.tsx](../world/components/Actor.tsx), because its defaults can carry a React component.

**Placement is deterministic and off the main thread.** Each class has a worker: spawn.worker (actors), dressing.worker, foliage.worker, all in [../utils/workers/](../utils/workers/). The same seed always gives the same points, so every client and the server agree without sending positions.

**Server sync.** Actors default to `serverSynced: true`: the server runs their state machines (see [NPC_TRACKING.md](../../NPC_TRACKING.md)). Dressing and foliage are deterministic scenery with nothing to sync. Setting `serverSynced` on them only logs a warning.

## How to use/add

Pick the class first, then follow that class's README:

- A new prop, NPC or building variant: [actors/README.md](actors/README.md)
- A new kind of scenery: [dressing/README.md](dressing/README.md)
- A new plant: [foliage/README.md](foliage/README.md)

A new shared attribute (one that two or more members need) goes into [types.ts](types.ts) at the highest level that fits. A new world-wide effect goes into the class base, never into one member.
