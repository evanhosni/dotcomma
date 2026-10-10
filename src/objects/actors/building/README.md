# Procedural buildings

## How it works

A building is an actor with no model file: its whole shape is generated from a seed (`buildingSeedAt`, the spawn position), so every client and the server get the same building.

1. [generatePlan.ts](generatePlan.ts) `generateBuildingPlan(seed, attrs)` → a pure-data `BuildingPlan` ([types.ts](types.ts)), from one seeded stream in a fixed phase order. Interior-first: rooms × stories set the footprint and height, and the shell ([rings.ts](rings.ts) lofted masses) wraps them. Each story has its own BSP rooms and a ramp; doors are openings in the ground floor.
2. [buildingAssets.ts](buildingAssets.ts) turns the plan into vertex-colored geometry and colliders, cached per seed and refcounted, built in queued phases (`beginProceduralBuildingBuild`; the interior mesh, `beginBuildingInteriorBuild`) so no single frame pays for a whole building. The geometry: [exteriorGeometry.ts](exteriorGeometry.ts) (the lofted shell with its door openings, the windows), [interiorGeometry.ts](interiorGeometry.ts) (`buildInteriorColliders`: walls, ramps, slabs and the inner shell; the interior mesh phases), both emitted through [buildingGeometry.ts](buildingGeometry.ts) (`TriangleSink`, baked vertex colors).
3. [Building.tsx](Building.tsx) runs on `useActorLifecycle` and adds hinged doors (click within `DOOR_INTERACT_REACH`; sent to the server as `door:<i>`) and the interior. Its shared materials, with the night window lights (a shader patch on the exterior), are [buildingMaterials.ts](buildingMaterials.ts).

Distance gates in [Building.tsx](Building.tsx):
- `INTERIOR_DISTANCE`: first approach builds the interior (`beginBuildingInteriorBuild`, queued phases) and mounts its children; it stays until despawn.
- `LIVE_DISTANCE`: inside, matrices update and real doors draw; outside, matrices freeze and doors are drawn by [farDoors.ts](farDoors.ts) as one shared InstancedMesh.
- `colliderDistance`: inside, real colliders; outside, one sealed convex hull of the silhouette ([proxyCollider.ts](proxyCollider.ts) `buildProxyHullVertices`, `createProxyCollider`). A building always has a collider. The server builds the same hull from the same plan.

Sprite LOD ([../../sprite-lod/README.md](../../sprite-lod/README.md)): every kind shares `BUILDING_SPRITE_LOD` (past its renderDistance, 625u, the building runs its 0.5s spawn fade out and its sprite takes over; sprites render to 3000u). [sprite.ts](sprite.ts) `describeBuildingSprite` reduces the same seeded plan to a silhouette profile: 6 heights, each with the mass's color and the building's mean width there (perimeter ÷ π, the right fixed width for a billboard that turns to face the camera), plus window rows. [buildingSpriteLook.ts](buildingSpriteLook.ts) draws it, with windows lit by the same per-night uniforms. The far doors follow the building's fade per instance, as they always did.

Kinds live in [spec.ts](spec.ts): `BUILDING_SPEC`, `SKYSCRAPER_SPEC` (the city), `HOUSE_SPEC` (the grass biome). A kind is an `ActorSpec` with `component: "building"`, `flattenGround: true` (the terrain flattens a pad under it) and a `hull`: the `BuildingAttributes` its shape comes from.

Two roof styles (`roof`, `ROOF_STYLE`):
- `FLAT`, the default: 2–4 lofted segments that lean, taper and lip, topped by caps and pipes.
- `PITCHED`, a house (`HOUSE_SPEC` also widens `aspectRange` to 0.6–1.67, so plans read as rectangles and stretched triangles): the door band's ring runs straight up to the eaves. On top sits an overhanging hip roof (`addHipRoof`): a soffit, a fascia, then every face at one pitch up the eave's straight skeleton (`hipRoofRings` in `rings.ts`, lofted through `ExteriorLoft.points`). It peaks over a triangle's incenter and ridges along a rectangle's long axis. Windows go in one row per story, ground floor included, and are kept clear of the doors. The walls are one color, and the roof's color comes from `roofColors`.

Every sized building is widened after the shaft fit by `widthScale` (default 1–1.5×), one roll for both axes. The spawn `footprint`, the road setback and `MAX_FOOTPRINT_REACH` (`workers/buildingFootprints.ts`) are sized for the widest shell, so change them together. Interior colors are clamped to a luminance band (`INTERIOR_WALL_LUMINANCE`, `INTERIOR_LUMINANCE`), because the interior is unlit. Every door leaf has a knob or lever on both faces (`doorHandle`); the far-door instances stay bare boxes.

## How to add another

**A variant** (e.g. a warehouse):
1. In [spec.ts](spec.ts), add `export const WAREHOUSE_SPEC: ActorSpec = { ...BUILDING_SPEC, id: "warehouse", hull: { …BuildingAttributes } }` plus its placement fields.
2. List `{ actor: WAREHOUSE_SPEC }` in a biome spec's `actors`. Shape knobs go in `hull`, never on the mount (the server builds its hull from the spec).

**A shape knob**:
1. Add the field to `BuildingAttributes` ([types.ts](types.ts)).
2. Add its key to `HULL_KEY_SET` ([spec.ts](spec.ts)).
3. Read it in the matching phase of [generatePlan.ts](generatePlan.ts). A new roll reshuffles every building in the world.
