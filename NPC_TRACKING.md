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
 deterministic point  ─────register───►     registered entity (entities/manager.ts)
                                            │
                                            ├─ looks the kind up in the ACTOR CATALOG
                                            │  (src/objects/actors/catalog.ts — the
                                            │  client's own spec files) and runs its
                                            │  STATE MACHINE (beeble/stateMachine.ts)
                                            │  at 10Hz with the nearest player as
                                            │  "the player"
                                            │
                                            ├─ the machine writes ctx.motion (velocity,
                                            │  facing) and ctx.animation (clip); the
                                            │  body (physics/npcBody.ts) resolves the
                                            │  motion on the server physics world:
                                            │  terrain, buildings, lamp posts, other
                                            │  players (Rapier + the shared character
                                            │  resolver) — or integrates it freely for
                                            │  a flyer
                                            │
 entityStore keeps the last snapshots ◄──── publishes changed fields: a stamped
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
(`src/objects/actors/Actor.tsx` → `useSyncedEntity`) sends
`entity:register {id, kind, x, y, z}`. The first registration creates the
server record and starts the machine; later registrations from other clients
just add themselves as listeners and receive the full current record. When the
last client unmounts it, the server forgets it. Interest is exactly "who has
it mounted", per domain.

The server ignores the registration's `y`: it places the body on its own
terrain (the same height function the client uses, bit-identical).

## 3. Simulation: the server runs the beeble's own state machine

`src/objects/actors/catalog.ts` lists every actor kind the server simulates,
by descriptor id:

```ts
[BEEBLE_SPEC.id]: BEEBLE_SPEC,
```

`BEEBLE_SPEC` is `src/objects/actors/beeble/spec.ts`: the state machine plus
the body (`body: "kinematic"`, a capsule, `movement: "ground"`). The state
machine is `beeble/stateMachine.ts` — the file you edit to change beeble
behavior. Both are imported straight into the server bundle. There is no
server copy of the behavior, and no server file names the beeble.

Each tick (100ms), for every beeble:

1. The machine ticks (`state/runner.ts`, the Three-free core). It sees the
   nearest player's position and distance, its own position, and its
   blackboard.
2. The machine's OUTPUTS are read: `ctx.motion` (horizontal velocity, a
   driven vertical velocity or "gravity", the facing) and `ctx.animation`
   (which clip, loop, speed, paused).
3. The body (`server/src/game/physics/npcBody.ts`) applies the motion. A
   `movement: "ground"` NPC is a `GroundBody`: the shared character resolver
   (`src/physics/characterMovement.ts`), which is the local player's exact
   movement code — slopes, sliding, gravity, autostep, collisions against
   terrain heightfields, building hulls, lamp and signal poles, and the other
   players' capsules. A `movement: "free"` NPC is a `FreeBody`: its velocity
   is integrated as-is, no gravity, no ground. The world steps once.
4. The body reports where it actually ended up and its actual velocity (a
   beeble walking into a wall publishes velocity 0 even while its machine says
   "walking").
5. `publishTick` (`entities/publish.ts`) compares that to what clients last
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
(`src/net/entities/entityStore.ts`).

Each frame, the actor base asks: "where was this beeble at
`serverTime − 200ms`?" and interpolates between the two snapshots on either
side of that moment (`src/net/entities/interpolation.ts`, driven by
`posePlayback.ts`). Because every client asks the same question of the same
data on the same clock, they all draw the same frame of the same track. It
does not matter when a message arrived, whether the browser hitched, or
whether two packets came in together — those were the causes of the old
"teleports" and "sliding".

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
channel's whole state — clip, loop, speed, paused, and the server times it
started / paused / last changed. `ModelActor` (`animationPlayer.ts`) applies
it once `serverTime − 200ms` reaches the change time, computing the exact clip
time from those clocks. So the idle clip begins exactly as the interpolated
body reaches the spot the server stopped it — on every client — and a pause
or a speed change lands in phase too.

The client still has a Rapier capsule for each beeble, parked at the drawn
pose every frame (`kinematicMover.tsx`), so the local player collides with
NPCs. It is not used to move anything.

State-keyed visuals (head tracking, the sphere-inflate on ascend) run on the
client: `ModelActor`'s state machine mirrors the server's current state id and
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

- **Move through `ctx.motion`.** `ctx.motion.move(vx, vz)` (units/s),
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
  the last frame) — or from a behavior through `ctx.animation`: `.play(clip,
  { loop, speed, restart })`, `.pause()`, `.resume()`, `.stop()`, `.setSpeed(s)`.
  Clip names are the GLTF's clips. Re-playing the clip that is already
  playing keeps its phase (a one-shot restarts).
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

```ts
export const BEEBLE_SM: StateMachineConfig = {
  initialState: "idle-walk",
  triggers: [ /* named conditions */ ],
  states:   [ /* what to do, and which trigger leads where */ ],
};
```

**Triggers** are named conditions evaluated every tick. Built-ins in
`state/triggers.ts`: `playerWithinRange(r)`, `playerOutsideRange(r)`,
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
`ctx.motion.fly(vy)` (the `ascending` state ramps it from 0 to 8 u/s). A
scene-only effect like the sphere-inflate lives in `onEnter` behind the
`groupRef` guard and returns a cleanup.

`onEnter` may return a function; it runs when the state is left (the beeble
uses it to dispose the inflate).

### What `ctx` gives you

`ctx.positionRef.current` (your position), `ctx.playerPosition` and
`ctx.playerDistanceSq` (the nearest player — on the server that is whoever is
closest, so no client is special), `ctx.delta` (seconds since last tick),
`ctx.elapsed`, `ctx.stateElapsed`, `ctx.blackboard`, `ctx.motion`,
`ctx.animation`, `ctx.input` (this tick's mouse flags — see §5), `ctx.groupRef`.

### Wiring a NEW NPC

1. **State machine** — `src/objects/actors/<name>/stateMachine.ts` following
   the contract above.
2. **Spec** — `src/objects/actors/<name>/spec.ts`, the Three-free half:
   ```ts
   export const X_SPEC: ActorSpec = {
     id: "x",
     stateMachine: X_SM,
     body: "kinematic",
     collider: { shape: "capsule", radius: 0.5, height: 2.4 },
     movement: "ground",          // or "free" for a flyer / swimmer
   };
   ```
3. **Catalog** — one line in `src/objects/actors/catalog.ts`:
   `[X_SPEC.id]: X_SPEC,`. (Forget it and `describeActor` throws at module
   load in dev, naming the line; `server/test/catalog.test.ts` catches it
   headlessly.)
4. **Descriptor** — `src/objects/actors/<name>/actor.tsx`, the client half:
   ```ts
   export const XDescriptor = describeActor<ModelActorAttributes>(X_SPEC, {
     component: ModelActor, model: "/models/x.glb", scale: [1, 1, 1], isStatic: false,
     footprint: 5, density: 200, clustering: 0, renderDistance: 200, priority: 80,
   });
   export const XActor = createActor(XDescriptor);
   ```
   No component: `ModelActor` wires the state machine, the mouse events, the
   capsule and the animation for every actor whose spec has a `stateMachine`.
5. Mount it in a biome's `<Actors>`: `<XActor biomeIds={[…]} />`.

That's the whole job. Terrain, buildings, poles, player collision, publishing,
interpolation and animation sync are all inherited. `serverSynced={false}` at
a mount runs the very same machine locally instead (same code path).

### Testing it without a browser

`server/test/entities.test.ts` runs the real beeble machine on a real physics
world: register the NPC, tick the manager, assert on `e.x/e.z/e.sm/e.anim`.
The "free" test there shows a flyer kind injected through the manager's
`specs` option. Copy one of those tests for a new NPC. `npm run physics:demo`
in `server/` drops a capsule on real terrain and walks slopes if you change
movement rules. `src/objects/actors/state/{motion,animation}.test.ts` cover
the two output channels.

---

## 7. Where things live

| what | where |
|---|---|
| beeble behavior (THE file to edit) | `src/objects/actors/beeble/stateMachine.ts` |
| beeble spec (behavior + body, what the server reads) | `src/objects/actors/beeble/spec.ts` |
| beeble descriptor (model + spawn) | `src/objects/actors/beeble/actor.tsx` |
| the actor catalog (kinds the server simulates) | `src/objects/actors/catalog.ts` |
| spec type, body/movement kinds | `src/objects/actors/spec.ts` |
| state machine core (runs on both sides) | `src/objects/actors/state/runner.ts`, `triggers.ts`, `types.ts` |
| motion + animation output channels, input reads | `src/objects/actors/state/motion.ts`, `animation.ts`, `input.ts` |
| movement rules (player AND every NPC) | `src/physics/characterMovement.ts` |
| server: tick orchestration, registration, input | `server/src/game/entities/manager.ts` |
| server: what gets sent | `server/src/game/entities/publish.ts` |
| server: an NPC's body (ground / free) | `server/src/game/physics/npcBody.ts`, `groundBody.ts`, `freeBody.ts` |
| server: the physics world, terrain, obstacles, hulls | `server/src/game/physics/physicsWorld.ts`, `chunks.ts`, `terrain.ts`, `obstacles.ts`, `buildings.ts` |
| server: the world it simulates on | `src/world/domains/glitch-city/config.ts` (via `world/domains/configs.ts`) |
| client: snapshot buffer | `src/net/entities/entityStore.ts` |
| client: interpolation (unit-tested) + per-actor playback | `src/net/entities/interpolation.ts`, `posePlayback.ts` |
| client: draws the pose / registers | `src/objects/actors/Actor.tsx` (`useSyncedEntity`) |
| client: behavior wiring, animation, collision capsule | `src/objects/actors/ModelActor.tsx`, `animationPlayer.ts`, `kinematicMover.tsx` |
| wire format (ONE copy, the server imports it) | `src/net/protocol.ts` |

## 8. Debugging

- Browser console, filter `[sync]`: `server moved <id> by Xu in one update`
  means the server's own track jumped (restart, respawn, backstop lift);
  `session reset` means a reconnect re-registered everything (a server restart
  puts NPCs back at spawn — `tsx watch` restarts on every save).
- Server console every 10s: `[physics] npcs … tick max … step … work …
  colliders … queue …`; a tick over 50ms warns.
- `__entities.list()` in the browser console lists every registered entity
  with its server state and position.
- `[domain] the JSX commit and the shared config … differ` in the browser
  console means a region/biome/flatten actor was mounted in JSX without being
  listed in the domain's `config.ts` — the server would stand NPCs on
  different ground. Fix the config.
- Remember: dotcomma.io runs the last deployed release. Uncommitted work only
  exists at `localhost:3000` (`npm run dev`).
