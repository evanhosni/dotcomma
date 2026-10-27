# Dressing

## How it works

Mass, identical, stateless scenery drawn as one `InstancedMesh` per chunk, with no per-object components: [street-lamps](street-lamps/README.md), [road-markers](road-markers/README.md), [traffic-lights](traffic-lights/README.md), [power-lines](power-lines/README.md), [bridges](bridges/README.md), [rocks](rocks/README.md), [snow-drift](snow-drift/README.md), [underground](underground/README.md) (caves and sewers; their own worker and chunk meshes), [particles](../../particles/README.md) (GPU-looped river spray and lake bubbles: one instanced quad mesh per chunk, one clock uniform per frame).

**The base** ([Dressing.tsx](Dressing.tsx)):
- `useDressingAssets`: creates shared geometries/materials once, runs each through `prepareDressingMaterial` (curvature, spawn fade), warms programs at load, disposes on unmount.
- `useDressingChunks({ renderDistance, build })`: camera-following chunk lifecycle on one shared budgeted queue, for features without colliders. `build(bounds)` returns an `Object3D` or `null`.
- `useSolidDressing(spec, …)`: the same lifecycle plus colliders from a `DressingColliderSpec`; `build(points, bodies, bounds)`, optional `onRemove`, and a `registry` for per-chunk animation. The bodies near the player become imperative Rapier bodies ([dressingColliders.tsx](dressingColliders.tsx), within `colliderDistance`, a few per frame nearest first). `DressingPartColliders` takes its `parts` by IDENTITY: a changed array rebuilds every body (each replaced the frame its successor is made, never a frame without it), so a feature passes ONE array, never an inline literal. A body is keyed by `key` (default `${x}_${z}`): a feature whose bodies can share a position must give them unique keys — two DIFFERENT bodies under one key, or a body Rapier refuses, is a content error, never a silent hole. A solid feature's props are `SolidDressingProps` (its distances only).
- `instancedFromPoints` builds a chunk mesh and ends in `finalizeInstancedChunk` (float-precision rebase, culling bounds, warm-up). `useDressingDefault` resolves a prop against the `<Dressing>` group.

**Placement** runs in the dressing worker: every enumerator is one entry in `DRESSING_ENUMERATORS` ([enumerators.ts](enumerators.ts)), requested with `enumerateDressing(name, bounds, args)` ([dressingWorker.ts](dressingWorker.ts)). `densityPoints` is generic density placement; the rest are structured (city road features in [../../utils/workers/roads/](../../utils/workers/roads): `roadMarkers.ts`, `trafficLights.ts`, `freewaySidePoints.ts`, `citySites.ts`, `runLamps.ts`; bridges in [../../utils/workers/bridges/](../../utils/workers/bridges)). An enumerator must assign each point to exactly one chunk by position.

**Colliders are data**: a Three-free `DressingColliderSpec` (`id`, `enumerator`, `placement`, `colliderParts`, `bodiesOf`) in the feature's `*Spec.ts`, listed in `DRESSING_COLLIDER_SPECS` ([catalog.ts](catalog.ts)). The server builds the same bodies from it, so a solid feature's placement lives only in its spec.

## How to add another

1. **Placement**: use `densityPoints`, or write a pure enumerator in its own file under [roads/](../../utils/workers/roads) (like [roadMarkers.ts](../../utils/workers/roads/roadMarkers.ts)), re-export it from `vertexCompute.ts`, add it to `DRESSING_ENUMERATORS` (wrap in `chunkMayHoldBiomes` if biome-limited), and add a determinism case to [cityFeatures.test.ts](../../utils/workers/roads/cityFeatures.test.ts).
2. **Component** `src/objects/dressing/<name>/<Name>.tsx`:
   ```tsx
   export const Benches = ({ renderDistance }: DressingAttributes) => {
     const distance = useDressingDefault("renderDistance", renderDistance, BENCH_RENDER_DISTANCE);
     const assets = useDressingAssets(() => ({ geometry: makeBenchGeometry(), material: makeBenchMaterial() }));
     const groupRef = useDressingChunks({
       renderDistance: distance,
       build: async (bounds) => {
         const points = await enumerateDressing("densityPoints", bounds, BENCH_PLACEMENT);
         return points.length ? instancedFromPoints(assets.geometry, assets.material, points, (p) => ({ ...p, yaw: benchYaw(p) })) : null;
       },
     });
     return <group ref={groupRef} />;
   };
   ```
3. **Solid** (optional): a Three-free `<name>Spec.ts` exporting its `DressingColliderSpec`, listed in `DRESSING_COLLIDER_SPECS`; swap `useDressingChunks` for `useSolidDressing`, take `SolidDressingProps` and draw from `bodies`. Patterns: [StreetLamps.tsx](street-lamps/StreetLamps.tsx) (`onRemove`), [TrafficLights.tsx](traffic-lights/TrafficLights.tsx) (`registry.forEachAlive`).
4. **Mount** it once: a biome-specific feature in that biome's `<Dressing>`; a FLAG-DRIVEN one (it draws every biome whose spec sets its flag: the tunnels, snow, rocks) or a world-wide one (the river spray, the lake bubbles) under `<Domain>` (overworld/domain.tsx) — call `useDomainWideDressing(name)` so a biome mount is a content error. Mounting twice draws it twice. A particle feature is a `createParticleDressing` spec ([particles/particleDressing.tsx](particles/particleDressing.tsx)), which does all of the above for it.

A collider part or mesh that capsules should climb at full speed (a ramp, stairs) sets `fullSpeedSlope: true` in its spec. The client and server mounts both tag it (physics/README.md).

A feature drawing its own ShaderMaterial (the tunnels, rocks, snow) builds it on the shared chunk projection ([world/shaders/chunkProjection.ts](../../world/shaders/chunkProjection.ts): the terrain's precision scheme, quantization and curvature in one GLSL function) and keeps it in `selfPatchedMaterial(material)` inside its assets: the base disposes it and applies only the spawn fade (the one effect the projection does not carry), never the curvature twice; the feature lists its own warm templates.
