# Power lines

## How it works

Utility poles with sagging wires along one side of every city freeway (arterials and the belt ring).

- **Placement:** the `freewayEdgePoints` enumerator → `getCityFreewayEdgePoints` / `getCityFreewaySidePoints` in [../../../utils/workers/roads/cityFeatures.ts](../../../utils/workers/roads/cityFeatures.ts). It returns points every `spacing` units, offset `freewayWidth + lateralMargin` from the freeway centerline, and drops any within `junctionClear` of a crossing freeway or on road surface. Only `side` 1 is kept. Each pole also gets its **next** pole, so it owns the wire span to it and wires stay continuous across chunk borders.
- **Art:** poles and crossarms as one InstancedMesh. Wires are a second InstancedMesh: 3 wires × 3 straight segments per span, faking the sag.
- **Colliders:** `POWER_LINES_SPEC` in [poleSpec.ts](poleSpec.ts) (listed in [../catalog.ts](../catalog.ts)): pole and crossarm only (`UTILITY_POLE_COLLIDER_PARTS`). Wires are deliberately not solid, because a collider at wire height across a freeway would be an invisible wall. The server builds the same poles from that spec.

Files: [PowerLines.tsx](PowerLines.tsx), [poleSpec.ts](poleSpec.ts) (Three-free sizes, colliders, `UTILITY_POLE_PLACEMENT` and the collider spec).

## How to use/add

Mount `<PowerLines />` in the city biome's `<Dressing>`. Props: `renderDistance` (default 420), `colliderDistance`.

The placement (`spacing` 55, `lateralMargin` 5, `junctionClear` 26, `side` 1) lives in `UTILITY_POLE_PLACEMENT` ([poleSpec.ts](poleSpec.ts)) only: the server places from the spec, so the component takes no placement props. (The client alone also asks for `withNext`, the wire spans; it moves no pole.)
