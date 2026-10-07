# Power lines

## How it works

Utility poles with sagging wires along one side of every city freeway (arterials and the belt).

- **Placement**: the `freewayEdgePoints` enumerator → `getCityFreewayEdgePoints` / `getCityFreewaySidePoints` ([../../../utils/workers/roads/freewaySidePoints.ts](../../../utils/workers/roads/freewaySidePoints.ts)), with `UTILITY_POLE_PLACEMENT` (`spacing`, `lateralMargin`, `junctionClear`, `side`). Each pole also gets its next pole, so it owns the wire span to it and wires stay continuous across chunks.
- **Art** ([PowerLines.tsx](PowerLines.tsx)): poles and crossarms as one InstancedMesh; wires as a second, a few straight segments per span faking the sag (`setInstanceTransform`).
- **Colliders**: `POWER_LINES_SPEC` ([poleSpec.ts](poleSpec.ts)) — pole and crossarm only (`UTILITY_POLE_COLLIDER_PARTS`); wires are not solid. The server builds the same poles.

## How to add another

N/A — one instance covers every freeway. Mount `<PowerLines />` once in the city biome's `<Dressing>` (props: `renderDistance`, `colliderDistance`); tune placement in `UTILITY_POLE_PLACEMENT`.
