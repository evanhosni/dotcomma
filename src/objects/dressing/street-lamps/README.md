# Street lamps

## How it works

Lamp posts along the city sidewalks. This is the **density-placed** dressing template ([../README.md](../README.md)).

- **Placement:** the `densityPoints` enumerator with `LAMP_PLACEMENT` from [lampSpec.ts](lampSpec.ts): density 4200, footprint 14, `roadDistanceRange` [8.2, 11.8] (the sidewalk band), city biome only. Density is high on purpose, because the sidewalk band is thin and footprint spacing does the real limiting. Each lamp's yaw is a hash of its position (`lampYaw`).
- **Art:** [lampGeometry.ts](lampGeometry.ts) merges pole, arm and head into one vertex-colored mesh. An `aLampMask` attribute limits the emissive glow to the head. The whole chunk is one draw call with one shared material, whose emissive intensity follows the day/night window-lights ramp.
- **Light:** each chunk registers its heads in the lamp-glow grid (`registerLampHeads` in [../../../lighting/lampGlow.ts](../../../lighting/lampGlow.ts)), so the pavement around them lights up at night. There are no real point lights. The chunk registry calls the returned disposer when a chunk unmounts.
- **Colliders:** `STREET_LAMPS_SPEC` in [lampSpec.ts](lampSpec.ts) (listed in [../catalog.ts](../catalog.ts)): cuboids (`LAMP_COLLIDER_PARTS`) for lamps within `LAMP_COLLIDER_DISTANCE` (60u). The server builds the same colliders from that spec.

Files: [StreetLamps.tsx](StreetLamps.tsx) (the component), [lampSpec.ts](lampSpec.ts) (Three-free sizes, colliders, placement and the collider spec, shared with the server) and [lampGeometry.ts](lampGeometry.ts).

## How to use/add

Mount `<StreetLamps />` in a biome's `<Dressing>` (today: the city biome). Props: `renderDistance` (default 440), `colliderDistance`, and the placement props `density`, `footprint`, `roadDistanceRange`, `biomeIds`, `heightRange`, `slopeRange`.

Tune the placement in `LAMP_PLACEMENT` ([lampSpec.ts](lampSpec.ts)), not at the mount: the server places its colliders from the spec, and a mount override logs a dev warning saying so.
