# Animation

## How it works

Two halves, so the server can own an animation it never draws:

- **The channel** ([index.ts](index.ts), Three-free): `AnimationChannel` holds ONE self-describing `AnimationState` ([types.ts](types.ts)): the clip, its params and a playhead (`origin` clip seconds at `anchor` ms on the channel's clock, moving at `speed`, backwards when `reverse`). Every command re-anchors the playhead at the frame on screen, so nothing jumps. A state machine's `ctx.animation` is one; on a synced NPC the SERVER's is the one, published whole as `anim` ([net/protocol.ts](../net/protocol.ts)) with server-time clocks, so every client poses the same frame.
- **The player** ([mixer.ts](mixer.ts)): `AnimationPlayer.update(target, root, state, inputs, nowMs, phaseMs)` poses a model from a state. The clip time is COMPUTED from the state and the clock on every call ([utils.ts](utils.ts) `playheadAt` → `wrapClipTime`), never accumulated, so a skipped call (frustum-culled, the far half-rate LOD) costs nothing and the next one lands in phase. The skeleton is evaluated (`mixer.update(0)` with each action's time and weight set) only when the posed frame changes: at `frameRate` 10, ten times a second. Frames tick on the clock (`frameTimeAt`), on a grid shifted per instance by `phaseMs`, so a crowd never re-poses on one frame. `state` null keeps posing the last state taken (a synced client waits for the delayed render clock to reach a change's `changedAt`).

| param | default | effect |
|---|---|---|
| `loop` | `"repeat"` | `"repeat"`, `"once"` (holds its last frame, its first reversed), `"pingpong"` |
| `speed` | 1 | clip seconds per second |
| `reverse` | false | plays backwards; a reversed one-shot starts at its end |
| `frameRate` | 0 | pose updates per second, stepped in REAL time (stop-motion); 0 = every rendered frame. Animation only: movement stays smooth |
| `intensity` | 1 | 0..1, the action weight: the pose moves only that far from the rest pose toward the clip |
| `fade` | 0 | seconds a newly played clip cross-fades from the previous clip's frame at the switch |

Commands: `play(clip, params)` (the clip already playing keeps its phase and takes the new params, unless `restart`; a one-shot restarts), `pause`, `resume`, `togglePause`, `stop`, `reverse`, `setReverse`, `setSpeed`, `setFrameRate`, `setLoop`, `setIntensity`, `seek(seconds)`, `adopt(state)`, `setInput(name, value)`. Reads: `clip`, `playing`, `paused`, `time`, `finished`.

**Durations.** The channel never loads a model, but clamping a one-shot (reversing it after it finished, seeking past its end) and starting a reversed clip at its end need the clip's length: a channel is built with `durations`. The client takes them from the loaded GLTF; the server reads them from the GLB file itself (`glbClipDurations`, [server/src/game/entities/clipDurations.ts](../../server/src/game/entities/clipDurations.ts)). A clip with no known duration still plays; only those clamps are skipped.

**Procedural clips.** A `ProceduralClip` (`name`, `duration`, `create(root)` → `{ pose(time, weight), dispose() }`) is a clip computed in code (a morph, a scale) that the channel plays by name like a keyframed one: same params, same sync, same frame rate. `dispose` must restore everything `pose` touched (models are pooled). Example: the beeble's `ascend` ([objects/actors/beeble/animations.ts](../objects/actors/beeble/animations.ts)). Playing one leaves the skeleton on its last frame.

**Procedural layers.** A `ProceduralLayer` (`name`, `create(root)` → `{ pose(inputs, weight), dispose() }`) is always on: it is posed OVER whatever clip plays, on the same frame ticks (so at the clip's `frameRate`), weighted by `intensity`. It is driven by the channel's `inputs` instead of time: the behavior calls `ctx.animation.setInput(name, value)` every tick and the layer samples it on each frame. Inputs are local to each machine and never published (a synced client's mirror runs the behavior and sets its own). An input left `undefined` hands the bone back to the clip on its next frame. Example: the beeble's head turn (`HEAD_TURN_LAYER`, fed `HEAD_YAW_INPUT`).

## How to use

- **An actor's animation**: `animation: { frameRate: 10, procedural: [MY_CLIP], layers: [MY_LAYER] }` on its spec (`AnimationConfig`: channel defaults for every play, plus its procedural clips and layers). The movement counterpart (speed, turn speed, drawn frame rate, the camera-relative yaw step) is the spec's `motion` ([objects/actors/state/README.md](../objects/actors/state/README.md)). `ModelActor` builds the channel and the player from it; nothing else is wired.
- **From a state machine**: `animation: { clip: "walk", speed: 1.5 }` on a state, or `ctx.animation.play(...)` / `.reverse()` / `.setIntensity(0.5)` from a behavior ([objects/actors/state/README.md](../objects/actors/state/README.md)). Clip names are the GLTF's, or a procedural clip's `name`.
- **A bone a behavior moves on top of a clip** (a head, an aim): never write the bone from the behavior (it would ignore the frame rate); make it a layer and `setInput` its value.
- **Anything else with an `AnimationMixer`**: own an `AnimationChannel` (`setClock` each frame) and an `AnimationPlayer`, and call `player.update(target, root, channel.state, channel.inputs, nowMs)`.
