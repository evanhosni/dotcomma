# Road markers

## How it works

Raised yellow studs on road centerlines instead of painted center lines. The smallest enumerator-placed feature, and the one to copy.

- **Placement**: the `roadMarkers` enumerator ([objects/dressing/registry.ts](../registry.ts)) combines `getCityRoadMarkers` (city streets and arterials, every `streetSpacing` / `freewaySpacing`, inset from intersections) and `getFreewayRunMarkers` (inter-city runs), both in [../../../generation/roads/dressing/index.ts](../../../generation/roads/dressing/index.ts). Each point carries a direction that becomes its yaw.
- **Art** ([RoadMarkers.tsx](RoadMarkers.tsx)): one low box per stud, unlit, sunk into the road, via `useWorldChunks` + `instancedFromPoints`. No colliders.

## How to add another

Mount `<RoadMarkers />` in a biome (props: `renderDistance`, `streetSpacing`, `freewaySpacing`). One driver covers every road of every biome that mounts it.
