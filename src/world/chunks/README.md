# Streaming chunks

## How it works

A camera-following window of fixed **256u cells** that build and dispose what stands in them, on
ONE budgeted queue. Everything streamed by POSITION — the dressing, the tunnels — is built on this,
so none of them can miss a world-wide effect.

**This is not terrain.** Terrain has its own chunks, sized per LOD level and driven by the quadtree
([terrain/](../terrain/README.md)). These are a flat grid at one size, below and beside it.

- **[types.ts](types.ts)** — Three-free, and the **SERVER imports it**: `WORLD_CHUNK_SIZE` (client
  and server must chunk identically — belt-freeway coverage depends on the query centre's wall set),
  `ChunkBounds`, `ChunkViewProps`, and the collider shapes (`ColliderPart`, `ColliderMesh`,
  `ColliderBody`).
- **[index.tsx](index.tsx)** — the lifecycle:
  - `useChunkAssets(create, warm?)`: shared geometries/materials once, each through
    `prepareChunkMaterial` (curvature, spawn fade), programs warmed at load, disposed on unmount.
  - `useWorldChunks({ renderDistance, build })`: the camera-following lifecycle. `build(bounds)`
    returns an `Object3D` or `null`; render the returned ref as `<group ref={groupRef} />`. Chunks
    are dropped 1.3× past the render distance so borders don't thrash, and each fades in as a chunk.
  - `useChunkRegistry(onRemove?)`: per-chunk side state, pruned lazily from your own frame loop
    (`forEachAlive`) and flushed on unmount — without that flush, external registrations (lamp
    heads in the glow grid) leaked as phantom lights across domain switches and HMR.
  - `selfPatchedMaterial(m)`: for a system with its own ShaderMaterial built on the shared chunk
    projection — the base then disposes it and applies only the spawn fade, never curvature twice.
- **[colliders.tsx](colliders.tsx)** — `useChunkColliders` + `<ChunkColliders>`: the bodies of the
  chunks near the player as imperative Rapier bodies, a few per frame nearest first, within
  `colliderDistance`. `<ChunkColliders>` takes its `parts` by IDENTITY — a changed array rebuilds
  every body — so a system passes ONE array, never an inline literal. A body is keyed by `key`
  (default `${x}_${z}`); a system whose bodies can share a position must set it, or one is dropped
  (reported, never a silent hole).

### Who is on it

| system | |
|---|---|
| [objects/dressing/](../../objects/dressing/README.md) | mass instanced scenery; adds `instancedFromPoints` and `useSolidDressing` on top |
| [world/underground/](../underground/README.md) | the tunnels; one lifecycle per biome that mounts them, since tunnel chunks are built per biome cell |

## How to put something on it

```tsx
const assets = useChunkAssets(() => ({ geometry: …, material: … }));
const groupRef = useWorldChunks({
  renderDistance: 400,
  build: async (bounds) => { … },   // deterministic per bounds; null = empty chunk
});
return <group ref={groupRef} />;
```

Add colliders by keeping a `useChunkRegistry` of chunks carrying `points: ColliderBody[]`, feeding
it to `useChunkColliders`, and rendering `<ChunkColliders>`.
