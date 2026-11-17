# Power lines

## How it works

Utility poles with sagging wires along one side of every city freeway (arterials and the belt).

- **Placement**: the `freewayEdgePoints` enumerator → `getCityFreewayEdgePoints` / `getCityFreewaySidePoints` ([../../../generation/roads/dressing/index.ts](../../../generation/roads/dressing/index.ts)), with `UTILITY_POLE_PLACEMENT` (`spacing`, `lateralMargin`, `junctionClear`, `side`). Each pole also gets its next pole, so it owns the wire span to it and wires stay continuous across chunks.
- **Art** ([PowerLines.tsx](PowerLines.tsx)): poles and crossarms as one InstancedMesh; wires as a second, a few straight segments per span faking the sag (`setInstanceTransform`, [../geometry.ts](../geometry.ts)).
- **Colliders**: `POWER_LINES_SPEC` ([spec.ts](spec.ts)) — pole and crossarm only (`UTILITY_POLE_COLLIDER_PARTS`); wires are not solid. The server builds the same poles.

## How to add another

Mount `<PowerLines />` in a biome (props: `renderDistance`, `colliderDistance`); tune placement in `UTILITY_POLE_PLACEMENT`. One driver covers every freeway of every biome that mounts it.
