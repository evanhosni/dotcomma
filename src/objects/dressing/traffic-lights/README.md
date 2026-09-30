# Traffic lights

## How it works

Signals at some city street intersections. Each one has a pole on a sidewalk corner, a mast arm, and a 3-lamp head facing the intersection.

- **Placement:** the `trafficLights` enumerator → `getCityTrafficLightPoints` in [../../../utils/workers/roads/cityFeatures.ts](../../../utils/workers/roads/cityFeatures.ts). It takes district grid corners where three or more differently-labelled blocks meet, skipping rim, roundabout and arterial corners, and keeps a seeded `chance` fraction of them. The pole walks diagonally out from the corner until the road field says sidewalk. A point is owned by its corner's world position, so chunks never duplicate one.
- **Art:** two InstancedMeshes per chunk: the body (base, pole, arm, head) and the lamps (3 per signal).
- **Animation:** lamps switch **chaotically**, not in a green → yellow → red cycle. Each hold is a random 0.2–1.5s, then the lamp jumps to either other state. Lamp colors are per-instance color writes. Each signal also registers a lamp-glow source whose color follows its state, so the pavement washes red/yellow/green at night ([../../../lighting/lampGlow.ts](../../../lighting/lampGlow.ts)).
- **Colliders:** `TRAFFIC_LIGHTS_SPEC` in [signalSpec.ts](signalSpec.ts) (listed in [../catalog.ts](../catalog.ts)): `SIGNAL_COLLIDER_PARTS` within the dressing collider distance (90u). The server builds the same ones from that spec.

Files: [TrafficLights.tsx](TrafficLights.tsx), [signalSpec.ts](signalSpec.ts) (Three-free sizes, colliders, `SIGNAL_PLACEMENT` and the collider spec).

## How to use/add

Mount `<TrafficLights />` in the city biome's `<Dressing>`. Props: `chance` (default `SIGNAL_PLACEMENT.chance` = 0.45), `renderDistance` (default 340), `colliderDistance`.

Change `chance` in [signalSpec.ts](signalSpec.ts), not at the mount: the server places its colliders from the spec, and a mount override logs a dev warning.
