# Dressing

## How it works

**Dressing** is mass, identical, stateless scenery: thousands of copies, no per-object React components, one `InstancedMesh` per 256u chunk. The existing features:
- [street-lamps/](street-lamps/README.md)
- [road-markers/](road-markers/README.md)
- [traffic-lights/](traffic-lights/README.md)
- [power-lines/](power-lines/README.md)
- [bridges/](bridges/README.md)

**The base** ([Dressing.tsx](Dressing.tsx)) owns everything features share:
- `useDressingChunks({ renderDistance, build })`: the camera-following chunk lifecycle. Chunks are queued nearest-first on one budgeted queue shared by all features, and dropped past 1.3× the render distance. Your `build(bounds)` returns a `THREE.Object3D` (or `null` for an empty chunk) and must be deterministic. Each chunk dithers in as it is added (the spawn fade, [../../vfx/spawnFade.ts](../../vfx/spawnFade.ts), per CHUNK: its instances appear together); chunks don't fade out — they drop at 1.3× the render distance.
- `useDressingAssets(() => ({ geometry, material, … }))`: creates your shared geometries/materials once, runs every material through `prepareDressingMaterial` (world curvature, the spawn fade) and disposes them on unmount. A material created anywhere else floats above the curved horizon.
- `instancedFromPoints(geometry, material, points, place)`: builds one chunk's `InstancedMesh`. `place` maps each point to `{ x, y, z, yaw }`, where local +X faces along `yaw`. It finishes through `finalizeInstancedChunk` (rebases the chunk for float precision, sets culling bounds, warms the GPU upload). Every instanced chunk must end there.
- `useChunkRegistry(onRemove)`: per-chunk side state (animation clocks, lamp-glow registrations), cleaned up when chunks unmount.
- `useDressingColliders(registry, { colliderDistance })` + `<DressingPartColliders parts=… />`: real cuboid colliders, but only for bodies within `colliderDistance` (default `DRESSING_COLLIDER_DISTANCE` = 90) of the camera.
- `useDressingDefault(key, ownProp, featureDefault)`: resolves `renderDistance` / `colliderDistance` as the prop, then the `<Dressing>` group's value, then the feature default.
- `useServerPlacementCheck(spec, placement)`: dev warning when a mount's props move a collider feature away from its spec (see below).

**Placement runs off-thread.** Every placement function is one entry in the enumerator table, [enumerators.ts](enumerators.ts) (`DRESSING_ENUMERATORS`: name → `(bounds, args) => points`). The dressing worker ([../../utils/workers/dressing.worker.ts](../../utils/workers/dressing.worker.ts)) runs any entry by name, and a component asks for it with the typed request `enumerateDressing(name, bounds, args)` from [dressingWorker.ts](dressingWorker.ts): args and point types come from the table, so there is no message type or wrapper to write. Today's entries:
- `densityPoints`: spawn-style random placement ([../../utils/workers/densityPoints.ts](../../utils/workers/densityPoints.ts)) with `seedTag`, `density`, `footprint`, `biomeIds`, `heightRange`, `slopeRange` and `roadDistanceRange`. It works in any biome: the chunk probe skips only chunks where none of `biomeIds` can be (unset = every biome). Street lamps use it.
- `freewayLamps`: lamps along both sides of the inter-city runs ([../../utils/workers/roads/runLamps.ts](../../utils/workers/roads/runLamps.ts)).
- `roadMarkers`, `trafficLights`, `freewayEdgePoints` (city road structure, [../../utils/workers/roads/cityFeatures.ts](../../utils/workers/roads/cityFeatures.ts)), `bridges` ([../../utils/workers/bridges/](../../utils/workers/bridges)), `cityLightSites`.

An enumerator must give the same points no matter how the world is chunked: each point belongs to exactly one chunk (by position).

**Colliders are data** ([types.ts](types.ts) `DressingColliderSpec`, listed in [catalog.ts](catalog.ts) `DRESSING_COLLIDER_SPECS`, the dressing twin of `actors/catalog.ts`). A spec is Three-free and lives in the feature's `*Spec.ts`: `{ id, enumerator, placement, colliderParts, bodiesOf }`. The component uses `placement` as its prop defaults, `bodiesOf(point)` for its collider bodies and `colliderParts` for their boxes. The server ([server/src/game/physics/obstacles.ts](../../../server/src/game/physics/obstacles.ts)) runs every catalog spec's enumerator with its `placement` and mounts the same bodies, so a solid feature needs no server code. The server never sees a mount, so a prop that overrides the placement is dev-warned by `useServerPlacementCheck`: change the spec instead.

## How to use/add

### A dressing feature

1. **Placement.** Density-placed: use `densityPoints`, nothing to write. Structured (lattices, intersections): write a pure `(minX, minZ, maxX, maxZ, …knobs) => Point[]` in [../../utils/workers/roads/cityFeatures.ts](../../utils/workers/roads/cityFeatures.ts) (or its own module next to it), re-export it from `vertexCompute.ts`, and add ONE entry to `DRESSING_ENUMERATORS` in [enumerators.ts](enumerators.ts). Wrap it in `chunkMayHoldBiomes(b, [SOME_BIOME_ID])` if it can only exist in some biomes. Add a determinism / no-duplicate case to [../../utils/workers/roads/cityFeatures.test.ts](../../utils/workers/roads/cityFeatures.test.ts).
2. **Component** `src/objects/dressing/benches/Benches.tsx`:
   ```tsx
   import * as THREE from "three";
   import { instancedFromPoints, useDressingAssets, useDressingChunks, useDressingDefault } from "../Dressing";
   import { enumerateDressing } from "../dressingWorker";
   import { DressingAttributes } from "../../types";
   import { CITY_BIOME_ID } from "../../../world/constants";

   export interface BenchesProps extends DressingAttributes {}

   export const Benches = ({ renderDistance, density = 800, footprint = 20 }: BenchesProps) => {
     const distance = useDressingDefault("renderDistance", renderDistance, 300);
     const assets = useDressingAssets(() => ({
       geometry: new THREE.BoxGeometry(2, 0.5, 0.6).translate(0, 0.25, 0),
       material: new THREE.MeshStandardMaterial({ color: "#6b4a2f" }),
     }));
     const groupRef = useDressingChunks({
       renderDistance: distance,
       build: async (bounds) => {
         const points = await enumerateDressing("densityPoints", bounds, {
           seedTag: "bench", // unique per feature: it seeds the placement
           density, footprint,
           biomeIds: [CITY_BIOME_ID],
           roadDistanceRange: [9, 11.5], // the sidewalk band (curb 7–8, sidewalk 8–12)
         });
         if (points.length === 0) return null;
         return instancedFromPoints(assets.geometry, assets.material, points, (p) => ({
           x: p.x, y: p.y, z: p.z, yaw: Math.abs(p.x * 3.1 + p.z * 1.7) % 6.283,
         }));
       },
     });
     return <group ref={groupRef} />;
   };
   ```
3. **Mount** `<Benches />` once, inside a biome's `<Dressing>` (e.g. [the city biome](../../world/domains/overworld/regions/city/biomes/city/biome.tsx)).

Files touched: 1 component + 1 mount (density-placed); + the enumerator, its table entry, its re-export and its test (structured).

### Making it solid (client and server)

1. In a Three-free `benchSpec.ts` next to the component, export the part boxes and the spec:
   ```ts
   export const BENCHES_SPEC: DressingColliderSpec<"densityPoints"> = {
     id: "Benches",
     enumerator: "densityPoints",
     placement: { seedTag: "bench", density: 800, footprint: 20, biomeIds: [CITY_BIOME_ID], roadDistanceRange: [9, 11.5] },
     colliderParts: [{ w: 2, h: 0.5, d: 0.6, x: 0, y: 0.25 }],
     bodiesOf: (p) => [{ x: p.x, y: p.y, z: p.z, yaw: Math.abs(p.x * 3.1 + p.z * 1.7) % 6.283 }],
   };
   ```
2. Add `BENCHES_SPEC` to `DRESSING_COLLIDER_SPECS` in [catalog.ts](catalog.ts). The server now builds its colliders.
3. In the component, take the defaults from `BENCHES_SPEC.placement`, call `useServerPlacementCheck(BENCHES_SPEC, placement)`, request `enumerateDressing(BENCHES_SPEC.enumerator, bounds, placement)`, and add the colliders: `useChunkRegistry` + `registry.add({ group, points: points.flatMap(BENCHES_SPEC.bodiesOf) })` + `useDressingColliders` + `<DressingPartColliders parts={BENCHES_SPEC.colliderParts} />` (the pattern in [street-lamps/StreetLamps.tsx](street-lamps/StreetLamps.tsx)).

Files touched: + 1 spec file and 1 catalog line (before: a spec file + a hand-wired block in `obstacles.ts`, plus a manual mirror of every mount override).

A dressing feature renders wherever the camera is, whichever biome it is mounted in, and its placement decides where points exist. Mount each feature **once**. Mounting it in two biomes draws it twice.
