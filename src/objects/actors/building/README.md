# Procedural buildings

## How it works

A building is an actor with no model file. Its whole shape is generated from a **seed**, which defaults to the spawn coordinates, so the same spot always gets the same building on every client and on the server.

**Pipeline:**
1. [generatePlan.ts](generatePlan.ts) `generateBuildingPlan(seed, attrs)` produces a pure-data `BuildingPlan` ([types.ts](types.ts)). It works **interior-first**: rooms per floor × stories set the footprint and height, and the shell wraps them.
   - Exterior: one or more 4–8-sided lofted masses ([rings.ts](rings.ts)) with lean, taper, lips, windows, a roof cap and pipes.
   - Interior: each story gets its own BSP room layout, doorways, light panels and a ramp to the next floor.
   - Doors: one or two openings in the ground-floor shell.
2. [buildingAssets.ts](buildingAssets.ts) turns the plan into geometry and colliders. Colors are baked as vertex colors, so every building shares one exterior material and one interior material. Results are cached per seed and refcounted. A new seed builds in four queued slices (plan → exterior → interior COLLIDERS → assembly), each queued by the one before it and ranked by distance, so the building nearest the player finishes first and a big tower never costs one long frame. The interior MESH is not part of this build (below).
3. [Building.tsx](Building.tsx) is the component (`component: "building"` on the spec). It runs on the actor base's `useActorLifecycle` and adds hinged doors (click within `DOOR_INTERACT_REACH`, 6u, to swing them open; the click is a local prediction and `door:<i>` to the server, which checks the player is within 6 + 3u of THAT door in the same seeded plan its hull comes from and broadcasts the state to everyone near the building), the interior, and the night window lights (a shader patch: a different subset of windows each night).

**Distances** (all from the building's center, on the ground plane):

| distance | what happens |
|---|---|
| `INTERIOR_DISTANCE` 60u | The FIRST time the player comes this close, the interior mesh is built (one queued task, `ensureBuildingInterior`) and mounted together with the building's `children`. From then on it stays mounted, with whatever state its children hold, until the building despawns. Walking away only hides it. |
| `LIVE_DISTANCE` 150u (+12u hysteresis) | Inside it the building's matrices update, the real clickable door leaves draw and the interior (if built) is shown. Beyond it the matrices freeze, the interior is hidden (never discarded), and the doors are drawn by [farDoors.ts](farDoors.ts): ONE InstancedMesh for every far door in the world, one draw call, kept in step with the replicated open/closed state. |
| `colliderDistance` 120u | Real colliders vs the sealed hull (below). Independent of the interior: interior state never depends on colliders. |
| render distance 625u (+ despawn ×1.1) | The building exists at all. Its doors are visible for its whole life. Despawn unmounts it and disposes its interior mesh. |

So an interior is only ever built for a building the player actually walked up to, and its memory is bounded by the buildings still spawned around the player.

**Colliders are never absent, only coarser** ([proxyCollider.ts](proxyCollider.ts)):
- **Within `colliderDistance` (default 120u):** the real colliders. That means the shell trimesh, interior walls, floors, ramps and closed door leaves.
- **Beyond it:** one convex hull of the building's silhouette. It seals the building, so NPCs stop at the wall.

The server builds the same sealed hull from the same plan (`server/src/game/physics/buildings.ts`).

**Spec** ([spec.ts](spec.ts)). A building kind is one `ActorSpec`: `component: "building"`, its placement (`footprint`, `density`, `roadDistanceRange`, `flattenGround: true` — the terrain flattens a pad under every building) and a `hull`: the `BuildingAttributes` its shape is generated from. The server builds the sealed hull from the `hull`, and the domain's config.ts derives the flatten pads from the biome mounts of the spec, so both are written once. A biome mount that overrides a hull attribute warns in dev (`BUILDING_HULL_KEYS`).

**Existing kinds** (all in [spec.ts](spec.ts)):
- `building` (`BUILDING_SPEC`), in the city.
- `skyscraper` (`SKYSCRAPER_SPEC` = `BUILDING_SPEC` + taller placement and hull), in the city.
- `grass-building` (`GRASS_BUILDING_SPEC` = `BUILDING_SPEC` under its own id), in the grass biome at `density: 25`.

**Shape knobs** (all optional, all on `BuildingAttributes` in [types.ts](types.ts); an array means "one of these choices", picked per building):

| knob | knob | knob |
|---|---|---|
| `exteriorSize` [w, h, d] | `shellHeightRange` | `numberOfSides` (default [4..8]) |
| `stories` | `roomCount` (per-floor choice) | `ceilingHeight` |
| `palette`, `accentColors`, `accentChance` | `windowShapes`, `windowCount`, `windowSize` | `maxLean` |
| `doorCount` (1 \| 2), `doorSize` | `windowLightChance` (default 0.6), `windowLightIntensity` | `interiorColors` |

## How to use/add

### A new building variant (e.g. "warehouse") — 3 edits, no new file (was 1 new file + 4 edits)

1. In [spec.ts](spec.ts), add the shape and the spec:
   ```ts
   export const WAREHOUSE_ATTRS: BuildingAttributes = {
     stories: 1,
     roomCount: [1, 2],
     numberOfSides: [4],
     shellHeightRange: [12, 18],
   };
   export const WAREHOUSE_SPEC: ActorSpec = {
     ...BUILDING_SPEC, id: "warehouse", footprint: 45, density: 300, priority: 50, hull: WAREHOUSE_ATTRS,
   };
   ```
   and add `[WAREHOUSE_SPEC.id]: WAREHOUSE_SPEC,` to [../catalog.ts](../catalog.ts) (the server builds its hull).
2. List it in a biome's `actors` (`src/world/domains/overworld/regions/<region>/biomes/<biome>/spec.ts`):
   `{ actor: WAREHOUSE_SPEC }` (it spawns in that biome only). The flatten pads follow automatically.

Put shape knobs in the spec's `hull`, not on the mount: the server generates its collider hull from the spec, so a shape override at the mount (dev warns) gives the server a different building than the one you see.
