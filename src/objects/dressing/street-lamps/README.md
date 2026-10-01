# Street lamps

## How it works

Lamp posts on city sidewalks (`<StreetLamps/>`) and along both sides of inter-city freeway runs (`<FreewayLamps/>`). Both are `LampPosts` in [StreetLamps.tsx](StreetLamps.tsx) on `useSolidDressing`.

- **Sidewalk placement**: `densityPoints` with `LAMP_PLACEMENT` ([lampSpec.ts](lampSpec.ts)), restricted by `roadDistanceRange` to the sidewalk band; yaw from `lampYaw`.
- **Freeway placement**: `freewayLamps` → `getFreewayRunLamps` ([../../../utils/workers/roads/runLamps.ts](../../../utils/workers/roads/runLamps.ts)) with `FREEWAY_LAMP_PLACEMENT`: a staggered lattice on each side of a run, offset solved against the road field, skipping cities, run ends, decks and water.
- **Art** ([lampGeometry.ts](lampGeometry.ts)): `getLampPostGeometry` merges pole, arm and head; `createLampPostMaterial` masks the emissive to the head. One draw call per chunk.
- **Light**: each chunk registers its heads with `registerLampHeads` ([../../../lighting/lampGlow.ts](../../../lighting/lampGlow.ts)) and releases them in `onRemove`. No real point lights.
- **Colliders**: `STREET_LAMPS_SPEC` / `FREEWAY_LAMPS_SPEC` (`LAMP_COLLIDER_PARTS`, within `LAMP_COLLIDER_DISTANCE`); the server builds the same.

## How to add another

N/A — one mount of each covers the world. Mount `<StreetLamps />` and `<FreewayLamps />` once in the city biome's `<Dressing>` (props: `renderDistance`, `colliderDistance`); tune `LAMP_PLACEMENT` / `FREEWAY_LAMP_PLACEMENT` in [lampSpec.ts](lampSpec.ts).
