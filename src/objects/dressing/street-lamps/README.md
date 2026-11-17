# Street lamps

## How it works

Lamp posts on city sidewalks (`<StreetLamps/>`) and along both sides of inter-city freeway runs (`<FreewayLamps/>`). Their declarations are [StreetLamps.tsx](StreetLamps.tsx) / [FreewayLamps.tsx](FreewayLamps.tsx); both draw through `LampPosts` ([LampPosts.tsx](LampPosts.tsx)) on `useSolidDressing`.

- **Sidewalk placement**: `densityPoints` with `LAMP_PLACEMENT` ([spec.ts](spec.ts)), restricted by `roadDistanceRange` to the sidewalk band and, through its `feature`, to the biomes that MOUNT `<StreetLamps/>`; yaw from `lampYaw`.
- **Freeway placement**: `freewayLamps` → `getFreewayRunLamps` ([../../../generation/roads/dressing/index.ts](../../../generation/roads/dressing/index.ts)) with `FREEWAY_LAMP_PLACEMENT`: a staggered lattice on each side of a run, offset solved against the road field, skipping cities, run ends, decks and water.
- **Art** ([geometry.ts](geometry.ts), [material.ts](material.ts)): `getLampPostGeometry` merges pole, arm and head; `createLampPostMaterial` masks the emissive to the head. One draw call per chunk.
- **Light**: each chunk registers its heads with `registerLampHeads` ([../../../lighting/lamp-glow/index.ts](../../../lighting/lamp-glow/index.ts)) and releases them in `onRemove`. No real point lights.
- **Colliders**: `STREET_LAMPS_SPEC` / `FREEWAY_LAMPS_SPEC` ([spec.ts](spec.ts): `LAMP_COLLIDER_PARTS`, within `LAMP_COLLIDER_DISTANCE`); the server builds the same.

## How to add another

Mount `<StreetLamps />` / `<FreewayLamps />` in a biome (props: `renderDistance`, `colliderDistance`). However many biomes mount one, ONE driver draws them all; tune `LAMP_PLACEMENT` / `FREEWAY_LAMP_PLACEMENT` in [spec.ts](spec.ts).
