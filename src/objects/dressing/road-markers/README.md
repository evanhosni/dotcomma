# Road markers

## How it works

Raised yellow studs on road centerlines, used instead of painted center lines (paint shimmered on the quantized terrain). This is the smallest **enumerator-placed** feature and the best one to copy ([../README.md](../README.md)).

- **Placement:** the `roadMarkers` enumerator ([../enumerators.ts](../enumerators.ts)), which returns:
  - `getCityRoadMarkers`: street and arterial centerlines inside the city, every `streetSpacing` / `freewaySpacing` units, inset away from intersections.
  - `getFreewayRunMarkers`: the inter-city freeway runs, which cross open country. These run even where the city probe (`chunkMayHoldBiomes`) says the chunk holds no city.

  Both live in [../../../utils/workers/roads/cityFeatures.ts](../../../utils/workers/roads/cityFeatures.ts). Each point carries a direction (`dirX`, `dirZ`) that becomes the stud's yaw.
- **Art:** one low frustum-shaped box, unlit `MeshBasicMaterial`, sunk 35% into the road. No colliders.

File: [RoadMarkers.tsx](RoadMarkers.tsx).

## How to use/add

Mount `<RoadMarkers />` in the city biome's `<Dressing>`. Props:
- `renderDistance` (default 340)
- `streetSpacing` (default 9u)
- `freewaySpacing` (default 11u)
