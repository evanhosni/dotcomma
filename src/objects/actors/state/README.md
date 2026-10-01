# NPC state machines

## How it works

An NPC's behavior is a `StateMachineConfig` ([types.ts](types.ts)): plain data and functions with no Three.js at runtime. The same file runs on the server (the authority — it moves the body and publishes pose, state and animation) and on each client as a mirror of the server's state id ([useStateMachine.ts](useStateMachine.ts), driven by `ModelActor`). `serverSynced={false}` runs it locally instead.

- [runner.ts](runner.ts): each tick, the current state's `transitions` are checked in order; the first whose `trigger` fires (and `guard` passes) enters its `target`, else `onUpdate` runs. A state has `id`, optional `animation`, `onEnter` (may return a cleanup), `onUpdate`, `transitions`. The config is validated once (unknown trigger, target or initial state).
- [triggers.ts](triggers.ts): `playerWithinRange`, `playerOutsideRange`, `afterDelay`, `randomInterval`, `blackboardFlag`, `always`, `custom`, `onMouseLeftClick` and the other mouse triggers.
- `ctx` (`BehaviorContext`): `ctx.motion` ([motion.ts](motion.ts): `move`, `heading`, `toward`, `fly`, `stop`, `face`, `faceHeading`, `faceToward`, `turnTo`, `turnToward`), `ctx.animation` ([animation.ts](animation.ts): `play`, `pause`, `resume`, `stop`, `setSpeed`), `ctx.input` ([input.ts](input.ts): this tick's mouse flags), `ctx.playerPosition`, `ctx.blackboard`, timing, and `ctx.groupRef.current` (null on the server).
- Input comes from a screen-center raycast within `interactReach` ([useMouseEvents.ts](useMouseEvents.ts)), forwarded to the server. On the server `ctx.input` is any player's; on a mirror only this player's.

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
