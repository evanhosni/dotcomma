# NPC state machines

## How it works

An NPC's behavior is a `StateMachineConfig` ([types.ts](types.ts)): plain data and functions with no Three.js at runtime. The same file runs on the server (the authority — it moves the body and publishes pose, state and animation) and on each client as a mirror of the server's state id ([useStateMachine.ts](useStateMachine.ts), driven by `ModelActor`). `serverSynced={false}` runs it locally instead.

- [runner.ts](runner.ts): each tick, the current state's `transitions` are checked in order; the first whose `trigger` fires (and `guard` passes) enters its `target`, else `onUpdate` runs. A state has `id`, optional `animation`, `onEnter` (may return a cleanup), `onUpdate`, `transitions`. The config is validated once (unknown trigger, target or initial state).
- [triggers.ts](triggers.ts): `playerWithinRange`, `playerOutsideRange`, `afterDelay`, `randomInterval`, `blackboardFlag`, `always`, `custom`, `onMouseLeftClick` and the other mouse triggers.
- `ctx` (`BehaviorContext`): `ctx.motion` ([motion.ts](motion.ts): `setSpeed`, `setTurnSpeed`, `pause`, `resume`, `move`, `heading`, `toward`, `fly`, `stop`, `face`, `faceHeading`, `faceToward`, `turnTo`, `turnToward`), `ctx.animation` (an `AnimationChannel`, [animation/](../../../animation/README.md): `play`, `pause`, `resume`, `stop`, `reverse`, `seek`, `setSpeed`, `setFrameRate`, `setIntensity`, …), `ctx.input` ([input.ts](input.ts): this tick's mouse flags), `ctx.playerPosition`, `ctx.blackboard`, timing, and `ctx.groupRef.current` (null on the server).
- Input comes from a screen-center raycast within `interactReach` ([useMouseEvents.ts](useMouseEvents.ts)), forwarded to the server. On the server `ctx.input` is any player's; on a mirror only this player's.

**Motion config** (the spec's `motion`, `MotionConfig`, the movement counterpart of `animation`):

| option | effect | where |
|---|---|---|
| `speed` | multiplies every velocity a behavior asks for (`ctx.motion.setSpeed` at runtime) | simulated: server and local |
| `turnSpeed` | multiplies every `turnTo`/`turnToward` step (`setTurnSpeed`) | simulated |
| `frameRate` | stop-motion: the DRAWN position and yaw update this many times a second; the body moves smoothly | client, the actor base |
| `rotationStep` | degrees: the DRAWN yaw is stepped relative to the camera's line of sight, so the viewer always sees an exact step | client, the actor base |

`ctx.motion.pause()` holds the body (a flyer hovers) and its turning while keeping what the behavior asked for; `resume()` carries on. The drawn frame rate steps on the same per-instance phase as the animation's (`framePhaseMsOf`), so equal rates step body and pose together.

Worked example: [../beeble/stateMachine.ts](../beeble/stateMachine.ts).

## How to add another

1. Create `src/objects/actors/<name>/stateMachine.ts`:
   ```ts
   export const FROG_SM: StateMachineConfig = {
     initialState: "wander",
     states: [
       { id: "wander", animation: { clip: "hop" },
         onEnter: (ctx) => ctx.motion.heading(Math.random() * TWO_PI, WANDER_SPEED).faceHeading(),
         transitions: [{ trigger: playerWithinRange(FLEE_RANGE), target: "flee" }] },
       { id: "flee",
         onUpdate: (ctx) => ctx.motion.heading(ctx.motion.angleTo(ctx.playerPosition.x, ctx.playerPosition.z) + Math.PI, FLEE_SPEED),
         transitions: [{ trigger: afterDelay(FLEE_TIME), target: "wander" }] },
     ],
   };
   ```
2. Set `stateMachine: FROG_SM` on the NPC's spec ([../README.md](../README.md)).
3. Rules: Three only as `import type`; move and animate only through `ctx.motion` / `ctx.animation`; guard scene access on `ctx.groupRef.current`; per-player effects are `if (ctx.groupRef.current && ctx.input.leftClick)`; give each `randomInterval` a unique id.
