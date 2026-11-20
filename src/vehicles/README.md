# Vehicles

## How it works

A car is an ACTOR (its own identity, a body, interaction) whose driving is shared by every car:

- **Dynamics** ([physics/vehicle/index.ts](../physics/vehicle/index.ts), `stepVehicle`): a ray-cast car on a DYNAMIC Rapier body, Three-free like the character resolver. Per wheel: a spring-damper along the body's up axis, a tire with a friction circle (side grip that slides past its limit, which is the drift), engine pull fading toward the top speed, brakes, coasting. Plus speed-sensitive steering, a handbrake that unloads the rear grip, air control (A/D yaw, W/S pitch), downforce, and a flip reset. Every number is in [physics/vehicle/constants.ts](../physics/vehicle/constants.ts), tuned for GRAVITY = −100.
- **Stats** (`VehicleStats`): top speed, acceleration, braking, handling (grip + steering), off-road (the grip and speed kept off a road). The driver samples the ground on the dressing worker every few frames (`distanceToRoadCenter < roadWidth` = on a road), so no height is read on the stepping thread.
- **Store** ([store.ts](store.ts)): every car with a body (`registerVehicle`) and the one the player sits in (`enterVehicle` / `leaveVehicle`, `onSeatChange`).
- **Driver** ([VehicleDriver.tsx](VehicleDriver.tsx), mounted ONCE inside `<Physics>` beside the Player): before each physics step it steps every awake car (the seated one on the keys, the rest on their parking brake; a sleeping body costs nothing). While driving: GTA's chase camera (trails the heading, the mouse orbits, swings back after `ORBIT_RETURN_DELAY`, pulled in by whatever the boom hits), the ground sample + a sink backstop, and F to get out (left side, else right, else the roof).
- **Player** ([player/Player.tsx](../player/Player.tsx)): while seated the capsule rides in the seat with its collider off and publishes the seat as its position; on leaving it takes the exit point (`takeExitPoint`).
- **HUD**: [menus/overlay/DrivingOverlay.tsx](../menus/overlay/DrivingOverlay.tsx).

Keys: W/S (accelerate; brake, then reverse), A/D, Space (handbrake), F (get out). Click a car to get in.

The pool sweeps a MOVING actor by where it is (`liveActorPositions`, objects/actors/store.ts), so a car driven across town is not unmounted for being far from where it was parked.

Not server-synced yet: placement is deterministic, so every client parks the same cars, but a driven car moves only for its driver.

## How to add another

A new car kind is an actor member like [objects/actors/scroller/](../objects/actors/scroller): a Three-free `spec.ts` (the `ActorSpec`, its `VehicleShape` wheels, mass, hull, seat), its art, and a component that builds the body inside a distance gate, `registerVehicle`s it, and calls `enterVehicle` on a click. Register it in `ACTOR_COMPONENTS` and mount `<Actor>` in a biome.
