# Utils

## How it works

These are shared helpers used across the game. The generation workers and the height pipeline are in [workers/](workers/) and have their own README.

| file | what it gives you |
|---|---|
| [math/_math.ts](math/_math.ts) | `MASTER_SEED` and `seedRand(seed)`. **Every deterministic roll in the game goes through `seedRand`**: same string in, same number in [0,1) out, on every client, worker and the server. Changing `MASTER_SEED` changes the whole world. It is bit-identical to `seedrandom(seed + MASTER_SEED)()` but faster (checked in `_math.test.ts`). Also GLSL-style `smoothstep`, `clamp`, `lerp`, and `distanceToSegment` on the x/z plane. Worker-safe (no Three). |
| [math/types.ts](math/types.ts) | `PointXZ`. The horizontal plane is always x/z, never `Vector2` or `.y`. |
| [utils.ts](utils.ts) | `getAllBiomes(regions)`, `getDistance2DSq(a, b)` (x/z), and `framePhaseFromCoords(x, z, n)`, which spreads "every Nth frame" work across instances so a spawn batch doesn't fire on the same frame. |
| [task-queue/TaskQueue.ts](task-queue/TaskQueue.ts) | `new TaskQueue({ weight?, bias? })` + `addTask(async () => …, { at: { x, z } })` / `removeTask(id)`. It runs queued main-thread work one task at a time per queue. ALL queues share ONE budget of ~6ms per frame (more below ~30fps), run after the frame paints; time spent awaiting a worker is not counted. **Priority:** each task's rank is its distance from `at` to the camera (the focus, set every frame by ActorPool) × the queue's weight + its bias, re-measured at every pick, and the lowest rank in ANY queue runs next (equal ranks keep insertion order). Weights today: buildings and GLTF clones 1, dressing 1.5, city lights biased into the background. Ranks above `BACKGROUND_RANK` (600) are background: they only run in the budget nearer work left, and while the machine is struggling (frames > 25ms) only in its first quarter. `isMachineStruggling()` and `chargeFrameWork(ms)` let the terrain loop share the same notion (see [world/terrain/](../world/terrain/README.md)). The collider worker has its own copy of the clock, in its own thread. |
| [uploadOnFirstDraw.ts](uploadOnFirstDraw.ts) | `uploadOnFirstDraw(mesh)` forces one draw at mount, so buffer uploads and shader linking happen then instead of the first time the player turns toward it. Use it on any mass content that can mount off-screen. |
| [spikeTrace.ts](spikeTrace.ts) | A lag-spike attribution ring buffer. `traceSpan(name, fn)` / `traceEvent(name)` in hot code. In the console, `__spikeTrace.traceWindow(frameStart, frameEnd)` lists what ran inside a long frame. Cheap enough to leave on. |
| [material/_material.ts](material/_material.ts) | `_material.loadTextures([...])` loads from `public/textures/` with repeat wrapping; `_material.fromShader(shader, textures)` is what `<Material shader textures>` builds a biome's or region's material with. `_material.combineBiomeMaterials(...)` builds the ONE terrain material from every biome and region frag: the per-pixel biome cross-fade, riverbed, the freeway corridor, night dim, lamp glow, the scene point lights and dither. It is called by [world/terrain/material.ts](../world/terrain/material.ts). |
| [cursor/cursor.ts](cursor/cursor.ts) | The centered crosshair dot. It is visible only under pointer lock. `showCursor()` / `hideCursor()` grow and shrink it when an interactable is hovered. |

## How to use/add

N/A for most of these, since you use them rather than add to them. Common recipes:

- **A deterministic random value**: `seedRand(\`mything_${x}_${z}\`)`. Salt the string with a feature name so two features at the same point don't roll the same number. Never use `Math.random()` for anything that must match across clients or the server.
- **Heavy main-thread work**: `const queue = new TaskQueue();` at module level, then `queue.addTask(async () => { … }, { at: { x, z } })` with the world position the work is for, so it takes its turn by distance. Split one big job into several tasks (a task may queue the next one, as buildings do): the budget is only checked between tasks, and every queue in the page shares it. Remove a task you no longer need (`removeTask`) rather than leaving a no-op in the queue.
- **Mass off-screen content**: call `uploadOnFirstDraw(mesh)` after creating it. The class bases (actor, dressing, foliage, terrain) already do this.
- **Tracing a suspected hitch**: wrap it with `traceSpan("my:thing", () => …)`.
- **A texture for a biome**: put the file in `public/textures/` and name it on the biome's material: `<Material shader={fragmentShader} textures={{ mytexture: "file.jpg" }} />`.
