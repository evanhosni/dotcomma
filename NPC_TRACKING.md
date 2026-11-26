# NPC tracking and syncing

How a beeble ends up in the same place, doing the same thing, on every
player's screen — and how to write the next NPC.

The short version: **the server is the only thing that ever moves an NPC.**
Every client just plays back what the server publishes, slightly delayed, and
draws it. No client predicts, no client owns anything, no player has an
advantage. And **you never write any of that**: an NPC is a state machine
plus a spec; the actor class does the rest, on both sides.

---

## 1. The moving parts

```
 CLIENT (each tab)                         SERVER (one, authoritative)
 ─────────────────────────────────         ─────────────────────────────────────────
 ActorPool spawns a beeble at a             EntityManager keeps one record per
 deterministic point  ─────register───►     registered entity (server/src/game/entities/EntityManager.ts)
                                            │
                                            ├─ looks the kind up in the ACTOR CATALOG
                                            │  (derived from the biome specs — the
                                            │  client's own spec files) and runs its
                                            │  STATE MACHINE (beeble/stateMachine.ts)
                                            │  at 10Hz with the nearest player as
                                            │  "the player"
                                            │
                                            ├─ the machine writes ctx.motion (velocity,
                                            │  facing) and ctx.animation (clip); the
                                            │  body (server/src/game/physics/bodies/index.ts) resolves the
                                            │  motion on the server physics world:
                                            │  terrain, buildings, lamp posts, other
                                            │  players (Rapier + the shared character
                                            │  resolver) — or integrates it freely for
                                            │  a flyer
                                            │
 entity store keeps the last snapshots ◄─── publishes changed fields: a stamped
 per entity                                 SNAPSHOT {st, x, y, z, vx, vy, vz, ry},
                                            the animation channel state, the machine
 Actor base draws the beeble 200ms behind   state id, replicated state
 the server clock by interpolating between
 snapshots (net/entities/posePlayback.ts)
 ModelActor applies the animation state on
 that same clock
```

## 2. Registration: how the server learns an NPC exists

Spawn points are deterministic (seeded from world coordinates), so every
client computes the same beeble at the same spot with the same id (something
like `123_456_beeble`). When a client mounts a beeble, the actor base
(`src/objects/actors/hooks.ts` → `useSyncedEntity`) sends
`entity:register {id, kind, x, y, z}`. The first registration creates the
server record and starts the machine; later registrations from other clients
just add themselves as listeners and receive the full current record. When the
last client unmounts it, the server forgets it. Interest is exactly "who has
it mounted", per domain.

The server ignores the registration's `y`: it places the body on its own
terrain (the same height function the client uses, bit-identical).

## 3. Simulation: the server runs the beeble's own state machine

The ACTOR CATALOG is every actor kind the domains' biomes place that the server
has something to simulate for (a state machine, a moving body, a hull), by spec
id. It is derived, not written: `ACTOR_CATALOG` in `src/world/domains/index.ts`
(`actorCatalogOf` in `src/objects/actors/registry.ts`) collects it from every
domain's tree, so the city biome mounting `<Actor actor={BEEBLE_SPEC}/>` is what
puts the beeble in it.

`BEEBLE_SPEC` is `src/objects/actors/beeble/spec.ts`: the state machine plus
the body (`body: "kinematic"`, a capsule, `movement: "ground"`). The state
machine is `beeble/stateMachine.ts` — the file you edit to change beeble
behavior. Both are imported straight into the server bundle. There is no
server copy of the behavior, and no server file names the beeble.

Each tick (100ms), for every beeble:

1. The machine ticks (`objects/actors/state/StateMachineRunner.ts`, the Three-free core). It sees the
   nearest player's position and distance, its own position, and its
   blackboard.
2. The machine's OUTPUTS are read: `ctx.motion` (horizontal velocity, a
   driven vertical velocity or "gravity", the facing) and `ctx.animation`
   (which clip, loop, speed, paused).
3. The body (`server/src/game/physics/bodies/index.ts`) applies the motion. A
   `movement: "ground"` NPC is a `GroundBody`: the shared character resolver
   (`src/physics/index.ts`), which is the local player's exact
   movement code — slopes, sliding, gravity, autostep, collisions against
   terrain heightfields, building hulls, lamp and signal poles, and the other
   players' capsules. A `movement: "free"` NPC is a `FreeBody`: its velocity
   is integrated as-is, no gravity, no ground. The world steps once.
4. The body reports where it actually ended up and its actual velocity (a
   beeble walking into a wall publishes velocity 0 even while its machine says
   "walking").
5. `publishTick` (`server/src/game/entities/utils.ts`) compares that to what clients last
   saw and sends only the changes — a stamped snapshot for any positional
   change, the whole animation state when the channel changed, the state id.

The terrain and obstacles around a ground body exist on the server only
because that body holds them: it requests the chunk under it (plus a neighbor
when near an edge), the chunks build row by row on a per-tick budget, and are
released when no body needs them. Until its chunks are built a beeble simply
doesn't move. A free body holds nothing.

## 4. Playback: how every client shows the same thing

Every positional update carries `st`, the server time of the tick that
produced it. The client keeps the last few of these snapshots per entity
(`src/net/entities/store.ts`).

Each frame, the actor base asks: "where was this beeble at
`serverTime − 200ms`?" and interpolates between the two snapshots on either
side of that moment (`src/net/entities/utils.ts`, driven by
`posePlayback.ts`). Because every client asks the same question of the same
data on the same clock, they all draw the same frame of the same track. It
does not matter when a message arrived, whether the browser hitched, or
whether two packets came in together: none of those can make a beeble jump or
slide.

Rules the sampler follows:

- Between two snapshots: linear interpolation of position and yaw.
- Past the newest snapshot (a late packet): extrapolate along its velocity for
  at most 250ms, then hold.
- A long gap between snapshots means the beeble was standing still (the
  server publishes nothing at rest): hold the old pose until one tick before
  the new snapshot, then move.
- Two snapshots more than 40u apart is a real relocation (server restart,
  respawn): jump, don't interpolate.

Animation uses the same delayed clock. The server publishes the animation
channel's whole state — clip, params, and a playhead anchored on the server
clock (`src/animation/`). `ModelActor`'s `AnimationPlayer` takes it once
`serverTime − 200ms` reaches the change time, computing the exact clip time
from those clocks. So the idle clip begins exactly as the interpolated
body reaches the spot the server stopped it — on every client — and a pause
or a speed change lands in phase too.

The client still has a Rapier capsule for each beeble, parked at the drawn
pose every frame (`objects/actors/model/hooks.ts`), so the local player collides with
NPCs. It is not used to move anything.

State-keyed visuals (head tracking) run on the client: `ModelActor`'s state machine mirrors the server's current state id and
enters the same state locally, but every output it produces is ignored.

## 5. Input: clicking a beeble

Inputs are not applied locally. Every mouse input the client's raycast detects
— hover enter/leave, any click, scroll — is forwarded by `useMouseEvents`
(owned by `ModelActor`) as `entity:interact "mouse-<flag>"`; the server raises
the same blackboard flag the machine's mouse trigger reads, and the machine's
own distance rule decides. INPUTS cross the wire, never triggers: the server's
machine evaluates its own triggers against its own flags. The resulting state change
(ascending) comes back to every client as published fields. Building doors
work the same way with `"door:<i>"`, toggling a replicated `state` blob.

### Shared reaction vs. per-player effect

A click can do two things at once, and they live in different places:

- **What the NPC does** (stop, face you, inflate, play a clip) is a state
  transition. The server's machine takes it and every client mirrors it —
  everyone sees the inflate.
- **What only the clicking player experiences** (a sound, a dialog box, a HUD
  line) is a scene-guarded read of `ctx.input` in the state the click lands in.
  On a client mirror the input flags come only from THAT player's own raycast,
  so the effect runs on exactly one screen:

  ```ts
  onUpdate: (ctx) => {
    if (ctx.groupRef.current && ctx.input.leftClick) playSound("you inflated me!");
  },
  ```

  On the server the same read means "any player clicked" — which is what a
  transition keyed on it should mean. Never put a per-player effect in the
  `onEnter` of the state the click transitions into: that runs on every client.

---

## 6. How to program an NPC (the beeble as the template)

You write ONE behavior file (a `StateMachineConfig`) and ONE spec. You never
write networking, never write physics, never write a component, never touch
the server.

### The contract

- **Move through `ctx.motion`.** Tune it with the spec's `motion: { speed, turnSpeed, frameRate, rotationStep }` and `ctx.motion.setSpeed` / `.pause()` / `.resume()` (src/objects/actors/state/README.md). `ctx.motion.move(vx, vz)` (units/s),
  `.heading(angle, speed)`, `.toward(x, z, speed)`, `.stop()`. `ctx.motion.fly(vy)`
  only when you want to drive vertical motion yourself (the beeble's ascend);
  `fly(null)` (the default after `stop()`) means normal gravity/ground
  following. For a `movement: "free"` NPC (flyer, swimmer) `fly` is just the
  vertical velocity and null means 0.
- **Face through `ctx.motion` too.** `.face(yaw)`, `.faceHeading()`,
  `.faceToward(x, z)`, `.turnToward(x, z, maxStep)` (per tick: rate × `ctx.delta`).
  `ctx.motion.yaw` and `.angleTo(x, z)` are the reads. Yaw is three.js
  `rotation.y`; a heading angle θ moves along (sin θ, cos θ), same convention.
  The framework applies all of this — never move the model yourself.
- **Animate by declaring it on the state** — `animation: { clip: "walk" }`
  (loops) or `{ clip: "stare at hands", loop: "once" }` (plays through, holds
  the last frame) — or from a behavior through `ctx.animation` (`.play`,
  `.pause`, `.reverse`, `.setIntensity`, … — [src/animation/README.md](src/animation/README.md)).
  Clip names are the GLTF's clips or the spec's procedural clips (the
  beeble's `ascend` inflate). Re-playing the clip that is already playing
  keeps its phase (a one-shot restarts).
- **Keep your own memory on the blackboard.** Anything the machine needs to
  remember between ticks (a target direction, a timer) goes in `ctx.blackboard`.
- **Guard scene access.** `ctx.groupRef.current` is the model on the client
  and `null` on the server. Bones, geometry, materials: only inside
  `if (ctx.groupRef.current)`. Everything that decides WHERE the NPC goes must
  not depend on the scene.
- **No Three.js at runtime in the config.** `import type * as THREE` is fine
  for types. Node has no scene.
- **`Math.random()` is fine.** The server is the single source of truth, so
  randomness never has to agree across clients.

### The pieces of a config

(Every config also gets the built-in `ragdoll` and `ragdoll-recover` states, and may set `ragdoll: { recoverClip, recoverSeconds }`: objects/actors/state/README.md.)

```ts
export const BEEBLE_SM: StateMachineConfig = {
  initialState: "idle-walk",
  triggers: [ /* named conditions */ ],
  states:   [ /* what to do, and which trigger leads where */ ],
};
```

**Triggers** are named conditions evaluated every tick. Built-ins in
`objects/actors/state/utils.ts`: `playerWithinRange(r)`, `playerOutsideRange(r)`,
`afterDelay(seconds)`, `randomInterval(id, min, max)`, `blackboardFlag(key)`,
`onMouseLeftClick()` and the other mouse triggers, and `custom(id, fn)` for
anything else. The beeble's "I can see the player" is a custom trigger:

```ts
custom("player-visible", (ctx) => {
  if (ctx.playerDistanceSq > SIGHT_RANGE * SIGHT_RANGE) return false;
  const toPlayer = ctx.motion.angleTo(ctx.playerPosition.x, ctx.playerPosition.z);
  return angleDiffAbs(ctx.motion.yaw, toPlayer) <= SIGHT_ANGLE;
}),
```

**States** have an id, an optional animation, `onEnter`, `onUpdate`, and
`transitions: [{ trigger, target }]`. The beeble's wandering state:

```ts
{
  id: "idle-walk",
  animation: { clip: "walk" },
  onEnter: (ctx) => {
    const bb = ctx.blackboard;
    bb.__dir_angle = randomAngle();      // remember where I'm heading
    bb.__dir_timer = randomRange(1, 5);  // and when to pick a new heading
    bb.__dir_elapsed = 0;
    ctx.motion.face(bb.__dir_angle);
  },
  onUpdate: (ctx) => {
    const bb = ctx.blackboard;
    bb.__dir_elapsed += ctx.delta;
    if (bb.__dir_elapsed >= bb.__dir_timer) { /* pick a new target heading */ }
    bb.__dir_angle = lerpAngle(bb.__dir_angle, bb.__dir_target, DIR_LERP_SPEED * ctx.delta);
    ctx.motion.heading(bb.__dir_angle, BEEBLE_SPEED)   // ← this is "movement"
              .fly(null)                                // gravity
              .face(bb.__dir_angle);                    // ← this is "facing"
  },
  transitions: [
    { trigger: "player-visible", target: "alert" },
    { trigger: "idle-look", target: "idle-look" },
  ],
},
```

Stopping is `ctx.motion.stop()` (the `alert` state does exactly that and
switches to the `idle` clip). Turning toward the player is
`ctx.motion.turnToward(px, pz, rate * ctx.delta)`. Flying up is
`ctx.motion.fly(vy)` (the `ascending` state ramps it from 0 to 8 u/s) while
it plays the procedural `ascend` clip. Any other scene-only effect lives in
`onEnter` behind the `groupRef` guard and returns a cleanup.

`onEnter` may return a function; it runs when the state is left.

### What `ctx` gives you

`ctx.positionRef.current` (your position), `ctx.playerPosition` and
`ctx.playerDistanceSq` (the nearest player — on the server that is whoever is
closest, so no client is special), `ctx.delta` (seconds since last tick),
`ctx.elapsed`, `ctx.stateElapsed`, `ctx.blackboard`, `ctx.motion`,
`ctx.animation`, `ctx.input` (this tick's mouse flags — see §5), `ctx.groupRef`.

### Wiring a NEW NPC

1. **State machine** — `src/objects/actors/<name>/stateMachine.ts` following
   the contract above.
2. **Spec** — `src/objects/actors/<name>/spec.ts`: the WHOLE actor, Three-free —
   behavior and body (what the server reads) plus the model and spawn knobs
   (copy `beeble/spec.ts`):
   ```ts
   export const X_SPEC: ActorSpec = {
     id: "x",
     stateMachine: X_SM,
     body: "kinematic",
     collider: { shape: "capsule", radius: 0.5, height: 2.4 },
     movement: "ground",          // or "free" for a flyer / swimmer
     model: "/models/x.glb", scale: [1, 1, 1],
     footprint: 5, density: 200, clustering: 0, renderDistance: 200, priority: 80,
   };
   ```
3. **Place it** — one `<Actor actor={X_SPEC}/>` in a biome's component
   (`src/world/domains/overworld/regions/<region>/biomes/<biome>/<Name>Biome.tsx`)
   — it spawns in exactly the biomes that mount it (mount overrides are its props),
   and mounting it is what puts it in the server's actor catalog.
   No component and no descriptor file: the client builds the descriptor from
   the spec, and `ModelActor` wires the state machine, the mouse events, the
   capsule and the animation for every actor whose spec has a `stateMachine`.

That's the whole job. Terrain, buildings, poles, player collision, publishing,
interpolation and animation sync are all inherited. `serverSynced: false` on
the placement runs the very same machine locally instead (same code path).
Scene logic the machine cannot express (bones, particles) goes in a ModelActor
wrapper with an `onFrame` — `src/objects/actors/README.md`, "An NPC with
scene logic".

### Testing it without a browser

`server/tests/entities.test.ts` runs the real beeble machine on a real physics
world: register the NPC, tick the manager, assert on `e.x/e.z/e.sm/e.anim`.
The "free" test there shows a flyer kind injected through the manager's
`specs` option. Copy one of those tests for a new NPC. `npm run physics:demo`
in `server/` drops a capsule on real terrain and walks slopes if you change
movement rules. `src/objects/actors/state/tests/motion.test.ts` and
`src/animation/tests/index.test.ts` cover the two output channels.

---

## 7. Where things live

| what | where |
|---|---|
| beeble behavior (THE file to edit) | `src/objects/actors/beeble/stateMachine.ts` |
| beeble spec (behavior + body + model + spawn knobs) | `src/objects/actors/beeble/spec.ts` |
| where the beeble is placed | its `<Actor>` in `src/world/domains/overworld/regions/city/biomes/city/CityBiome.tsx` (and the other biomes that mount it) |
| the actor catalog (kinds the server simulates, derived from the biome specs) | `ACTOR_CATALOG` in `src/world/domains/index.ts` (`actorCatalogOf`: `src/objects/actors/registry.ts`) |
| spec type, body/movement kinds | `src/objects/actors/spec.ts` |
| state machine core (runs on both sides) | `src/objects/actors/state/StateMachineRunner.ts`, `utils.ts` (triggers), `types.ts` |
| motion + animation output channels, input reads | `src/objects/actors/state/motion.ts`, `src/animation/AnimationChannel.ts`, `src/objects/actors/state/input.ts` |
| movement rules (player AND every NPC) | `src/physics/index.ts` |
| server: tick orchestration, registration, input | `server/src/game/entities/EntityManager.ts` |
| server: what gets sent | `server/src/game/entities/utils.ts` |
| server: an NPC's body (ground / free) | `server/src/game/physics/bodies/index.ts` (`createNpcBody`), `GroundBody.ts`, `FreeBody.ts` |
| server: the physics world, terrain, obstacles, hulls | `server/src/game/physics/physicsWorld.ts`, `ChunkStore.ts`, `utils.ts` (terrain and obstacle samplers), `bodies/index.ts` (obstacle bodies, hulls) |
| server: the world it simulates on | `src/world/content/config/index.ts` (via `world/domains/index.ts`) |
| client: snapshot buffer | `src/net/entities/store.ts` |
| client: interpolation (unit-tested) + per-actor playback | `src/net/entities/utils.ts`, `posePlayback.ts` |
| client: draws the pose / registers | `src/objects/actors/hooks.ts` (`useSyncedEntity`) |
| client: behavior wiring, animation, collision capsule | `src/objects/actors/model/ModelActor.tsx`, `src/animation/`, `objects/actors/model/hooks.ts` |
| wire format (ONE copy, the server imports it) | `src/net/protocol/types.ts` |

## 8. Debugging

- Browser console, filter `[sync]`: `server moved <id> by Xu in one update`
  means the server's own track jumped (restart, respawn, backstop lift);
  `session reset` means a reconnect re-registered everything (a server restart
  puts NPCs back at spawn — `tsx watch` restarts on every save).
- Server console every 10s: `[physics] npcs … tick max … step … work …
  colliders … queue …`; a tick over 50ms warns.
- `__entities.list()` in the browser console lists every registered entity
  with its server state and position.
- `[domain] the JSX commit and the shared config … differ in: …` in the
  browser console means the ground the client commits differs from the
  domain's shared `world/content/config/index.ts` (built from the same region/biome specs) — the
  server would stand NPCs on different ground. Fix the spec or the config.
- Remember: dotcomma.io runs the last deployed release. Uncommitted work only
  exists at `localhost:3000` (`npm run dev`).
