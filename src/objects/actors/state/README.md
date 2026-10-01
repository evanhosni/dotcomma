# NPC state machines

## How it works

An NPC's behavior is a `StateMachineConfig` ([types.ts](types.ts)): plain data and functions with **no Three.js at runtime**. The same config file runs in two places:

- **On the server**, as the one authority. The server ticks it at 10 Hz, with the nearest player as "the player", moves the body from its motion output and publishes the pose, state and animation to every client.
- **On each client**, as a mirror ([useStateMachine.ts](useStateMachine.ts), driven by `ModelActor`). The mirror follows the server's state id, so state-keyed visuals (bone tweaks, morphs) still run where there is a scene. An actor mounted with `serverSynced={false}` runs the machine locally instead.

The core is [runner.ts](runner.ts). Each tick it evaluates the current state's `transitions` in order. The first one whose trigger fires (and whose `guard`, if any, passes) enters the target state. Otherwise the state's `onUpdate` runs.

A config has two parts:
- `states`: each has an `id`, optional `animation`, `onEnter` (may return a cleanup run on exit), `onUpdate`, and `transitions`: `{ trigger, target, guard? }`. A `trigger` is a trigger OBJECT, built with the helpers in [triggers.ts](triggers.ts): `playerWithinRange(r)`, `playerOutsideRange(r)`, `afterDelay(s)`, `randomInterval(id, min, max)`, `blackboardFlag(key)`, `always()`, `custom(id, fn)`, and `onMouseLeftClick()` and the other mouse triggers. The runner collects them — there is no list to keep in sync. (A transition may still name a trigger by id if the config lists it in the optional `triggers`.)
- `initialState`.

The runner checks the config once when the first machine is built: an unknown trigger id, an unknown transition target or a missing initial state throws outside production (logs in production), instead of silently never firing.

What a behavior can touch, through `ctx` (a `BehaviorContext`):

| | |
|---|---|
| `ctx.motion` ([motion.ts](motion.ts)) | `move(vx, vz)`, `heading(angle, speed)`, `toward(x, z, speed, arrive?)`, `fly(vy \| null)` (null = gravity), `stop()`, `face(yaw)`, `faceHeading()`, `faceToward(x, z)`, `turnTo(yaw, step)`, `turnToward(x, z, step)`. Reads: `yaw`, `speed`, `moving`, `angleTo(x, z)`, `facingErrorTo(x, z)`. The output persists until you change it. Units are world units per second. Heading θ moves along (sin θ, cos θ). |
| `ctx.animation` ([animation.ts](animation.ts)) | `play(clip, { loop, speed, restart })`, `pause()`, `resume()`, `stop()`, `setSpeed(s)`. The state shorthand `animation: { clip, loop?: "repeat" \| "once", speed? }` calls `play` on enter. Clip names are the GLTF's. |
| `ctx.input` ([input.ts](input.ts)) | this tick's mouse flags: `hovering`, `hoverEnter`, `leftClick`, `rightClick`, `scrollUp`… |
| `ctx.playerPosition`, `ctx.playerDistanceSq` | the nearest player |
| `ctx.delta`, `ctx.elapsed`, `ctx.stateElapsed` | seconds |
| `ctx.blackboard` | per-instance memory between ticks |
| `ctx.groupRef.current` | the Three group. **Null on the server**: guard every scene access on it. |

**Input and whose it is.** Clicks and hovers come from a screen-center raycast on the client ([useMouseEvents.ts](useMouseEvents.ts)). The raycast hits skinned meshes only, within the spec's `interactReach` (default 5u; the server accepts inputs from within `interactReach + 3`). Every input is forwarded to the server, and triggers are evaluated there. On the server `ctx.input.leftClick` means *any* player clicked. On a client mirror it means *this* player clicked. So a per-player effect (a sound, a dialog) is `if (ctx.groupRef.current && ctx.input.leftClick) …`, and a state change on click is a transition on `onMouseLeftClick()`. A machine with an `onMouseLeftClick()` transition also makes the cursor grow on hover.

The worked example is [../beeble/stateMachine.ts](../beeble/stateMachine.ts).

## How to use/add

1. Create `src/objects/actors/<name>/stateMachine.ts`:
   ```ts
   import { afterDelay, onMouseLeftClick, playerWithinRange } from "../state/triggers";
   import type { StateMachineConfig } from "../state/types";

   const PLAYER_NEAR = playerWithinRange(10);
   const CLICKED = onMouseLeftClick();

   export const FROG_SM: StateMachineConfig = {
     initialState: "wander",
     states: [
       {
         id: "wander",
         animation: { clip: "hop" },
         onEnter: (ctx) => {
           ctx.motion.heading(Math.random() * Math.PI * 2, 3).fly(null).faceHeading();
         },
         transitions: [
           { trigger: PLAYER_NEAR, target: "flee" },
           { trigger: CLICKED, target: "flee" },
         ],
       },
       {
         id: "flee",
         animation: { clip: "hop", speed: 2 },
         onUpdate: (ctx) => {
           const away = ctx.motion.angleTo(ctx.playerPosition.x, ctx.playerPosition.z) + Math.PI;
           ctx.motion.heading(away, 8).faceHeading();
         },
         transitions: [{ trigger: afterDelay(3), target: "wander" }],
       },
     ],
   };
   ```
2. Reference it from the NPC's `spec.ts` (`stateMachine: FROG_SM`) and place the spec in a biome ([../README.md](../README.md), "An NPC").

Rules that keep it working on the server:
- Import Three only as `import type`.
- Move and animate only through `ctx.motion` and `ctx.animation`, never by writing to the scene.
- `Math.random()` is fine, because the server is the only authority.
- A trigger id must be unique inside a config: `randomInterval` keys its timer on its id, so two of them need two ids.
