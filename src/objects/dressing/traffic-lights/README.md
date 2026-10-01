# Traffic lights

## How it works

Signals at some city street intersections: a pole on a sidewalk corner, a mast arm, and a lamp head facing the intersection.

- **Placement**: the `trafficLights` enumerator → `getCityTrafficLightPoints` ([../../../utils/workers/roads/cityFeatures.ts](../../../utils/workers/roads/cityFeatures.ts)): district grid corners where several differently-labelled blocks meet (not roundabout or arterial corners), kept by a seeded `chance` from `SIGNAL_PLACEMENT`; the pole walks out from the corner to the sidewalk. Owned by the corner's position.
- **Art** ([TrafficLights.tsx](TrafficLights.tsx)): two InstancedMeshes per chunk (body, lamps).
- **Animation**: lamps switch chaotically on random holds via per-instance colors, driven through `registry.forEachAlive`; each signal is a lamp-glow source whose color follows its state.
- **Colliders**: `TRAFFIC_LIGHTS_SPEC` ([signalSpec.ts](signalSpec.ts), `SIGNAL_COLLIDER_PARTS`); the server builds the same.

## How to add another

N/A — one instance covers every intersection. Mount `<TrafficLights />` once in the city biome's `<Dressing>` (props: `renderDistance`, `colliderDistance`); tune `chance` in `SIGNAL_PLACEMENT`.
