# Road markers

## How it works

Raised yellow studs on road centerlines instead of painted center lines. The smallest enumerator-placed feature, and the one to copy.

- **Placement**: the `roadMarkers` enumerator ([../enumerators.ts](../enumerators.ts)) combines `getCityRoadMarkers` (city streets and arterials, every `streetSpacing` / `freewaySpacing`, inset from intersections) and `getFreewayRunMarkers` (inter-city runs), both in [../../../utils/workers/roads/cityFeatures.ts](../../../utils/workers/roads/cityFeatures.ts). Each point carries a direction that becomes its yaw.
- **Art** ([RoadMarkers.tsx](RoadMarkers.tsx)): one low box per stud, unlit, sunk into the road, via `useDressingChunks` + `instancedFromPoints`. No colliders.

## How to add another

N/A — one instance covers every road. Mount `<RoadMarkers />` once in the city biome's `<Dressing>` (props: `renderDistance`, `streetSpacing`, `freewaySpacing`).
