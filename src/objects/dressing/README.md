# Dressing

## How it works

Mass, identical, stateless scenery drawn as one `InstancedMesh` per chunk, with no per-object components: [street-lamps](street-lamps/README.md), [road-markers](road-markers/README.md), [traffic-lights](traffic-lights/README.md), [power-lines](power-lines/README.md), [bridges](bridges/README.md), [rocks](rocks/README.md), [snow-drift](snow-drift/README.md), [underground](underground/README.md) (caves and sewers; their own worker and chunk meshes), [particles](../particles/README.md) (GPU-looped river spray and lake bubbles: one instanced quad mesh per chunk, one clock uniform per frame).

**The base** ([index.tsx](index.tsx)). `useChunkAssets`, `useWorldChunks`, `useChunkRegistry` and `selfPatchedMaterial` are re-exported from [world/chunks/](../../world/chunks/README.md) so a feature has one import; what is added here:
- `useSolidDressing(spec, …)`: the same lifecycle plus colliders from a `DressingColliderSpec`; `build(points, bodies, bounds)`, optional `onRemove`, and a `registry` for per-chunk animation. The bodies near the player become imperative Rapier bodies ([world/chunks/colliders.tsx](../../world/chunks/colliders.tsx), within `colliderDistance`, a few per frame nearest first). `ChunkColliders` takes its `parts` by IDENTITY: a changed array rebuilds every body (each replaced the frame its successor is made, never a frame without it), so a feature passes ONE array, never an inline literal. A body is keyed by `key` (default `${x}_${z}`): a feature whose bodies can share a position must give them unique keys — two DIFFERENT bodies under one key, or a body Rapier refuses, is a content error, never a silent hole. A solid feature's props are `SolidDressingProps` (its distances only).
- `instancedFromPoints` builds a chunk mesh and ends in `finalizeInstancedChunk` (float-precision rebase, culling bounds, warm-up).
- **ONE DRIVER PER KIND.** A feature mounted in a biome renders NOTHING: it registers, and the single `Driver` `<Domain>` mounts draws every mount of that kind — chunks are world-space, so a driver per mount would build each one twice. The driver reads its mounts with `featureMounts(kind)` and takes the `farthest` view distance among them ([utils.ts](utils.ts)). The tunnels are the exception: their chunks are built per biome cell and never overlap, so they run one lifecycle per biome.

**Placement** runs in the dressing worker: every enumerator is one entry in `DRESSING_ENUMERATORS` ([enumerators.ts](enumerators.ts)), requested with `enumerateDressing(name, bounds, args)` ([worker.ts](worker.ts)). `densityPoints` is generic density placement — it names a `feature` (the declaration's kind) instead of `biomeIds`, so the points stand in whichever biomes MOUNTED that feature and no placement anywhere names a biome; the rest are structured (city road features in [../../utils/workers/roads/](../../utils/workers/roads): `roadMarkers.ts`, `trafficLights.ts`, `freewaySidePoints.ts`, `citySites.ts`, `runLamps.ts`; bridges in [../../utils/workers/bridges/](../../utils/workers/bridges)). An enumerator must assign each point to exactly one chunk by position.

**Colliders are data**: a Three-free `DressingColliderSpec` (`id`, `enumerator`, `placement`, `colliderParts`, `bodiesOf`) in the feature's `spec.ts`, listed in `DRESSING_COLLIDER_SPECS` ([catalog.ts](catalog.ts)). The server builds the same bodies from it, so a solid feature's placement lives only in its spec.

## How to add another

1. **Placement**: use `densityPoints`, or write a pure enumerator in its own file under [roads/](../../utils/workers/roads) (like [roadMarkers.ts](../../utils/workers/roads/roadMarkers.ts)), re-export it from `vertexCompute.ts`, add it to `DRESSING_ENUMERATORS` (wrap in `chunkMayHoldBiomes` if biome-limited), and add a determinism case to [cityFeatures.test.ts](../../utils/workers/roads/cityFeatures.test.ts).
2. **The feature** — one folder, `index.tsx` holding its declaration AND its driver:
   ```tsx
   export const BENCHES = "benches";

   /** BENCHES along the sidewalks of the biome this is mounted in. */
   export const Benches = declare<SolidDressingProps>({
     kind: BENCHES,
     within: "biome",
     read: (node) => ({ ...node.props }),
     Driver: () => <BenchesDriver />,
   });

   const BenchesDriver = () => {
     const mounts = featureMounts<SolidDressingProps>(BENCHES);
     const assets = useChunkAssets(() => ({ geometry: makeBenchGeometry(), material: makeBenchMaterial() }));
     const groupRef = useWorldChunks({
       renderDistance: farthest(mounts, "renderDistance", BENCH_RENDER_DISTANCE),
       build: async (bounds) => {
         const points = await enumerateDressing("densityPoints", bounds, BENCH_PLACEMENT);
         return points.length ? instancedFromPoints(assets.geometry, assets.material, points, (p) => ({ ...p, yaw: benchYaw(p) })) : null;
       },
     });
     return <group ref={groupRef} />;
   };
   ```
   Its `BENCH_PLACEMENT` sets `feature: BENCHES` instead of `biomeIds`.
3. **Solid** (optional): a Three-free `spec.ts` exporting its `DressingColliderSpec`, listed in `DRESSING_COLLIDER_SPECS`; swap `useWorldChunks` for `useSolidDressing` and draw from `bodies`. Patterns: [street-lamps/index.tsx](street-lamps/index.tsx) (`onRemove`), [traffic-lights/index.tsx](traffic-lights/index.tsx) (`registry.forEachAlive`).
4. **Mount it** in the biomes it belongs to: `<Benches />` inside their `<Biome>`. Nothing else — no registry line, no flag, no domain-level mount. A particle feature is a `createParticleDressing` spec ([../particles/index.tsx](../particles/index.tsx)), which returns a declaration like any other.

A collider part or mesh that capsules should climb at full speed (a ramp, stairs) sets `fullSpeedSlope: true` in its spec. The client and server mounts both tag it (physics/README.md).

A feature drawing its own ShaderMaterial (the tunnels, rocks, snow) builds it on the shared chunk projection ([world/shaders/chunkProjection.ts](../../world/shaders/chunkProjection.ts): the terrain's precision scheme, quantization and curvature in one GLSL function) and keeps it in `selfPatchedMaterial(material)` inside its assets: the base disposes it and applies only the spawn fade (the one effect the projection does not carry), never the curvature twice; the feature lists its own warm templates.
