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

Kinds live in [spec.ts](spec.ts): `BUILDING_SPEC`, `SKYSCRAPER_SPEC`, `GRASS_BUILDING_SPEC`. A kind is an `ActorSpec` with `component: "building"`, `flattenGround: true` (the terrain flattens a pad under it) and a `hull`: the `BuildingAttributes` its shape comes from.

## How to add another

**A variant** (e.g. a warehouse):
1. In [spec.ts](spec.ts), add `export const WAREHOUSE_SPEC: ActorSpec = { ...BUILDING_SPEC, id: "warehouse", hull: { …BuildingAttributes } }` plus its placement fields.
2. List `{ actor: WAREHOUSE_SPEC }` in a biome spec's `actors`. Shape knobs go in `hull`, never on the mount (the server builds its hull from the spec).

**A shape knob**:
1. Add the field to `BuildingAttributes` ([types.ts](types.ts)).
2. Add its key to `HULL_KEY_SET` ([spec.ts](spec.ts)).
3. Read it in the matching phase of [generatePlan.ts](generatePlan.ts). A new roll reshuffles every building in the world.
