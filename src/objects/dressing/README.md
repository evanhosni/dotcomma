# Dressing

## How it works

**Dressing** is mass, identical, stateless scenery: thousands of copies, no per-object React components, one `InstancedMesh` per 256u chunk. The existing features:
- [street-lamps/](street-lamps/README.md)
- [road-markers/](road-markers/README.md)
- [traffic-lights/](traffic-lights/README.md)
- [power-lines/](power-lines/README.md)
- [bridges/](bridges/README.md)

**The base** ([Dressing.tsx](Dressing.tsx)) owns everything features share. A feature uses four of its pieces:
- `useDressingAssets(() => ({ geometry, material, … }))`: creates your shared geometries/materials once, runs every material through `prepareDressingMaterial` (world curvature, the spawn fade) and disposes them on unmount. A material created anywhere else floats above the curved horizon. Its programs are linked at domain load (`utils/warmPrograms.ts`): by default one InstancedMesh template per material (what `instancedFromPoints` draws); a feature drawing anything else passes `warm: (assets) => [...]` as the second argument (bridges: `meshTemplate(deck)`; traffic lights: `instancedTemplate(lamps, { instanceColor: true })`). Forgetting one is a dev error: every chunk is checked as it is added (`reportUnwarmedPrograms`), naming the material and the variant it draws.
- `useDressingChunks({ renderDistance, build })`: the camera-following chunk lifecycle, for a feature WITHOUT colliders. Chunks are queued nearest-first on one budgeted queue shared by all features, and dropped past 1.3× the render distance. Your `build(bounds)` returns a `THREE.Object3D` (or `null` for an empty chunk) and must be deterministic. Each chunk dithers in as it is added (the spawn fade, [../../vfx/spawnFade.ts](../../vfx/spawnFade.ts), per CHUNK: its instances appear together); chunks don't fade out. Chunk objects are added with `freezeStaticSubtree` (they never move). Resolve the distance with `useDressingDefault("renderDistance", ownProp, featureDefault)` (the prop, then the `<Dressing>` group's value, then the default).
- `useSolidDressing(spec, { renderDistance, defaultRenderDistance, colliderDistance, build, onRemove? })`: the same lifecycle for a feature WITH colliders (a `DressingColliderSpec`, below). It runs the spec's enumerator with the spec's placement, hands `build(points, bodies, bounds)` the chunk's points and the collider bodies `spec.bodiesOf` places for them, and returns `{ content, registry }`: render `content` (the chunks plus real cuboid colliders for the bodies within `colliderDistance`, default 90u, as imperative Rapier bodies — never `<RigidBody>`s, r-t-r syncs every mounted one each frame). `build` returns `{ group, …side state }`; `onRemove(chunk)` releases the side state (lamp-glow heads) when the chunk unmounts, and `registry.forEachAlive` drives per-chunk animation from your own `useFrame` (traffic lights).
- `instancedFromPoints(geometry, material, points, place)`: builds one chunk's `InstancedMesh`. `place` maps each point to `{ x, y, z, yaw }`, where local +X faces along `yaw`. It finishes through `finalizeInstancedChunk` (rebases the chunk for float precision, sets culling bounds, warms the GPU upload), which a hand-built instanced mesh must end in too (`setInstanceTransform` writes one instance: the power-line wires).

**Placement runs off-thread.** Every placement function is one entry in the enumerator table, [enumerators.ts](enumerators.ts) (`DRESSING_ENUMERATORS`: name → `(bounds, args) => points`). The dressing worker ([../../utils/workers/dressing.worker.ts](../../utils/workers/dressing.worker.ts)) runs any entry by name, and a component asks for it with the typed request `enumerateDressing(name, bounds, args)` from [dressingWorker.ts](dressingWorker.ts): args and point types come from the table, so there is no message type or wrapper to write. Today's entries:
- `densityPoints`: spawn-style random placement ([../../utils/workers/densityPoints.ts](../../utils/workers/densityPoints.ts)) with `seedTag`, `density`, `footprint`, `biomeIds`, `heightRange`, `slopeRange` and `roadDistanceRange`. It works in any biome: the chunk probe skips only chunks where none of `biomeIds` can be (unset = every biome). Street lamps use it.
- `freewayLamps`: lamps along both sides of the inter-city runs ([../../utils/workers/roads/runLamps.ts](../../utils/workers/roads/runLamps.ts)).
- `roadMarkers`, `trafficLights`, `freewayEdgePoints` (city road structure, [../../utils/workers/roads/cityFeatures.ts](../../utils/workers/roads/cityFeatures.ts)), `bridges` ([../../utils/workers/bridges/](../../utils/workers/bridges)), `cityLightSites`.

An enumerator must give the same points no matter how the world is chunked: each point belongs to exactly one chunk (by position).

**Colliders are data** ([types.ts](types.ts) `DressingColliderSpec`, listed in [catalog.ts](catalog.ts) `DRESSING_COLLIDER_SPECS`, the dressing twin of the actor catalog). A spec is Three-free and lives in the feature's `*Spec.ts`: `{ id, enumerator, placement, colliderParts, bodiesOf }`. The server ([server/src/game/physics/obstacles.ts](../../../server/src/game/physics/obstacles.ts)) runs every catalog spec's enumerator with its `placement` and mounts the same bodies, so a solid feature needs no server code. The server never sees a mount, so a solid feature's placement is its spec's ONLY: its component takes no placement props (`renderDistance` and `colliderDistance` only — anything else is a type error). To move a solid feature's points, change the spec.

## How to use/add

### A dressing feature — 1 new file + 1 mount (density-placed); + the enumerator, its table entry, its re-export and its test (structured) (unchanged)

1. **Placement.** Density-placed: use `densityPoints`, nothing to write. Structured (lattices, intersections): write a pure `(minX, minZ, maxX, maxZ, …knobs) => Point[]` in [../../utils/workers/roads/cityFeatures.ts](../../utils/workers/roads/cityFeatures.ts) (or its own module next to it), re-export it from `vertexCompute.ts`, and add ONE entry to `DRESSING_ENUMERATORS` in [enumerators.ts](enumerators.ts). Wrap it in `chunkMayHoldBiomes(b, [SOME_BIOME_ID])` (same file) if it can only exist in some biomes. Add a determinism / no-duplicate case to [../../utils/workers/roads/cityFeatures.test.ts](../../utils/workers/roads/cityFeatures.test.ts).
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

### Making it solid (client and server) — + 1 spec file, + 1 catalog line, one hook in the component (was: the spec + the catalog line + five base pieces hand-wired in the component, and a dev warning for every mount prop the server never saw)

1. In a Three-free `benchSpec.ts` next to the component, export the spec (the placement moves here from the component):
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
3. In the component, swap `useDressingChunks` for `useSolidDressing`, draw from the bodies (so the drawn yaw IS the collider's), and drop the placement props:
   ```tsx
   export const Benches = ({ renderDistance, colliderDistance }: Pick<DressingAttributes, "renderDistance" | "colliderDistance">) => {
     const assets = useDressingAssets(() => ({ /* as before */ }));
     const { content } = useSolidDressing(BENCHES_SPEC, {
       renderDistance, defaultRenderDistance: 300, colliderDistance,
       build: (_points, bodies) => {
         const group = new THREE.Group();
         group.add(instancedFromPoints(assets.geometry, assets.material, bodies, (b) => b));
         return { group };
       },
     });
     return content;
   };
   ```
   The pattern with per-chunk side state is [street-lamps/StreetLamps.tsx](street-lamps/StreetLamps.tsx) (`onRemove`), with animation [traffic-lights/TrafficLights.tsx](traffic-lights/TrafficLights.tsx) (`registry.forEachAlive`).

A dressing feature renders wherever the camera is, whichever biome it is mounted in, and its placement decides where points exist. Mount each feature **once**. Mounting it in two biomes draws it twice.
