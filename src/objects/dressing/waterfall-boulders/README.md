# Waterfall boulders

## How it works

Bare, wet rocks in every river — dense where the river FALLS (a piece steeper than the `<Water>` base's `fallGrade`), the odd one in calm water — and where a fall's white water bursts on them (`<WaterfallSplashes/>`). Rivers cross every region, so this is a part of the `<Water>` base, mounted once: `<Water><WaterfallBoulders/></Water>`. Unmounted, there are none, on the client and the server alike.

- **Placement** ([generation/water/parts/waterfall-boulders/index.ts](../../../generation/water/parts/waterfall-boulders/index.ts) `getWaterfallBoulders`, its own `waterfallBoulders` enumerator): along every built river piece, one rock per `spacing`² of water on a fall and per `calmSpacing`² in calm water, across 95% of the half-width, sizes skewed small; kept where the point is wet, off decks and out of lake biomes; each rests on the lowest drawn ground under its footprint with its top over the water, and one whose base would hang too far over the ground is dropped. The splash enumerator reads the SAME list (with each rock's fall grade and downhill direction). Rules and numbers: [rocks/README.md](../rocks/README.md) "Waterfall boulders".
- **Art**: the rock look — [rocks/geometry.ts](../rocks/geometry.ts) `buildRockMesh` and [rocks/material.ts](../rocks/material.ts) `createRockMaterial` — one merged mesh per chunk, never snowed.
- **Colliders** ([spec.ts](spec.ts) `WATERFALL_BOULDERS_SPEC`, Three-free): each rock's trimesh (`rockColliderBodies`), built by the server's obstacles from the same mount in the config.

| prop | default | what it tunes |
|---|---|---|
| `spacing`, `calmSpacing` | 14, 32 | one boulder per spacing² of water on a fall / in calm water |
| `renderDistance`, `colliderDistance` | the rocks' | how far they draw and collide |

## How to add another

N/A: one mount covers every river of the domain. Tune it on the mount: `<WaterfallBoulders spacing={10} />`.
