# NPC tracking and syncing

How a beeble ends up in the same place, doing the same thing, on every
player's screen — and how to write the next NPC.

The short version: **the server is the only thing that ever moves an NPC.**
Every client just plays back what the server publishes, slightly delayed, and
draws it. No client predicts, no client owns anything, no player has an
advantage.

---

## 1. The moving parts

```
 CLIENT (each tab)                         SERVER (one, authoritative)
 ─────────────────────────────────         ─────────────────────────────────────────
 ActorPool spawns a beeble at a             EntityManager keeps one record per
 deterministic point  ─────register───►     registered entity (entities/manager.ts)
                                            │
                                            ├─ runs the beeble's STATE MACHINE
                                            │  (beeble/stateMachine.ts — the client's
                                            │  own file) at 10Hz with the nearest
                                            │  player as "the player"
                                            │
                                            ├─ the machine writes a VELOCITY to its
                                            │  blackboard; NpcBody (physics/npc.ts)
                                            │  resolves it on the server physics
                                            │  world: terrain, buildings, lamp posts,
                                            │  other players (Rapier + the shared
                                            │  character resolver)
                                            │
 entityStore keeps the last snapshots ◄──── publishes changed fields: a stamped
 per entity                                 SNAPSHOT {st, x, y, z, vx, vy, vz, ry},
                                            plus clip / state id / replicated state
 Actor base draws the beeble 200ms behind
 the server clock by interpolating between
 snapshots (net/entities/interpolation.ts)
 ModelActor starts the clip on that same clock
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

`server/src/game/entities/kinds.ts` maps a descriptor id to what the server
simulates:

```ts
beeble: { sm: BEEBLE_SM, body: BEEBLE_COLLIDER },
```

`BEEBLE_SM` is `src/objects/actors/beeble/stateMachine.ts` — the file you
edit to change beeble behavior. It is imported straight into the server
bundle. There is no server copy of the behavior.

Each tick (100ms), for every beeble:

1. The machine ticks (`state/runner.ts`, the Three-free core). It sees the
   nearest player's position and distance, its own position, and its
   blackboard.
2. The machine's OUTPUTS are read off the blackboard: `__vel_x`, `__vel_z`
   (horizontal velocity, units/s), `__vel_y` (a driven vertical velocity —
   `undefined` means gravity), `__yaw`, and the current state's `animation`.
3. `NpcBody.step` (`server/src/game/physics/npc.ts`) hands that velocity to
   the shared character resolver (`src/physics/characterMovement.ts`), which
   is the local player's exact movement code: slopes, sliding, gravity,
   autostep, collisions against terrain heightfields, building hulls, lamp and
   signal poles, and the other players' capsules. The world steps once.
4. `NpcBody.pose` reads back where the body actually ended up and its actual
   velocity (a beeble walking into a wall publishes velocity 0 even while its
   machine says "walking").
5. `publishTick` (`entities/publish.ts`) compares that to what clients last
   saw and sends only the changes.

The terrain and obstacles around a beeble exist on the server only because
that beeble holds them: `NpcBody` requests the chunk under it (plus a neighbor
when near an edge), the chunks build row by row on a per-tick budget, and are
released when no body needs them. Until its chunks are built a beeble simply
doesn't move.

## 4. Playback: how every client shows the same thing

Every positional update carries `st`, the server time of the tick that
produced it. The client keeps the last few of these snapshots per entity
(`src/net/entities/entityStore.ts`).

Each frame, the actor base asks: "where was this beeble at
`serverTime − 200ms`?" and interpolates between the two snapshots on either
side of that moment (`src/net/entities/interpolation.ts`). Because every
client asks the same question of the same data on the same clock, they all
draw the same frame of the same track. It does not matter when a message
arrived, whether the browser hitched, or whether two packets came in together
— those were the causes of the old "teleports" and "sliding".

Rules the sampler follows:

- Between two snapshots: linear interpolation of position and yaw.
- Past the newest snapshot (a late packet): extrapolate along its velocity for
  at most 250ms, then hold.
- A long gap between snapshots means the beeble was standing still (the
  server publishes nothing at rest): hold the old pose until one tick before
  the new snapshot, then move.
- Two snapshots more than 40u apart is a real relocation (server restart,
  respawn): jump, don't interpolate.

Animation uses the same delayed clock: the server sends the clip name and the
server time it started (`clipT0`); `ModelActor` starts the clip once
`serverTime − 200ms` reaches `clipT0`, at the right offset into the clip. So
the idle clip begins exactly as the interpolated body reaches the spot the
server stopped it — on every client.

The client still has a Rapier capsule for each beeble, parked at the drawn
pose every frame (`kinematicMover.tsx`), so the local player collides with
NPCs. It is not used to move anything.

State-keyed visuals (head tracking, the sphere-inflate on ascend) run on the
client: `useStateMachine` mirrors the server's current state id and enters
the same state locally, but every movement output it produces is ignored.

## 5. Input: clicking a beeble

Clicks are not applied locally. `useMouseEvents` forwards a click as
`entity:interact "mouse-left-click"`; the server raises the same blackboard
flag the machine's `onMouseLeftClick` trigger reads, and the machine's own
distance rule decides. The resulting state change (ascending) comes back to
every client as published fields. Building doors work the same way with
`"door:<i>"`, toggling a replicated `state` blob.

---

## 6. How to program an NPC (the beeble as the template)

You write ONE file: a `StateMachineConfig`. You never write networking, never
write physics, never touch the server beyond one line in `kinds.ts`.

### The contract

- **Move by writing velocity to the blackboard.** `bb.__vel_x`, `bb.__vel_z`
  in units per second (the beeble uses 5). `bb.__vel_y` only when you want to
  drive vertical motion yourself (the beeble's ascend); leave it `undefined`
  for normal gravity/ground following. Facing is `bb.__yaw` (radians, three.js
  rotation.y). The framework applies all of these — never move the model
  yourself.
- **Animate by declaring it on the state.** `animation: { clipName: "walk" }`
  (loop) or `{ clipName: "stare at hands", loop: LOOP_ONCE, clampWhenFinished: true }`.
  Clip names are the GLTF's clips.
- **Keep your own memory on the blackboard.** Anything the machine needs to
  remember between ticks (a target direction, a timer) goes in `ctx.blackboard`.
- **Guard scene access.** `ctx.groupRef.current` is the model on the client
  and `null` on the server. Bones, geometry, materials: only inside
  `if (ctx.groupRef.current)`. Everything that decides WHERE the NPC goes must
  not depend on the scene.
- **No Three.js at runtime in the config.** `import type * as THREE` is fine
  for types; loop modes come from `LOOP_ONCE` / `LOOP_REPEAT` in
  `state/types.ts`. Node has no scene.
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
  const facing = ctx.blackboard.__dir_angle ?? 0;
  return angleDiffAbs(facing, angleToPlayer(ctx)) <= SIGHT_ANGLE;
}),
```

**States** have an id, an optional animation, `onEnter`, `onUpdate`, and
`transitions: [{ trigger, target }]`. The beeble's wandering state:

```ts
{
  id: "idle-walk",
  animation: { clipName: "walk" },
  onEnter: (ctx) => {
    const bb = ctx.blackboard;
    bb.__dir_angle = randomAngle();      // remember where I'm heading
    bb.__dir_timer = randomRange(1, 5);  // and when to pick a new heading
    bb.__dir_elapsed = 0;
    bb.__yaw = bb.__dir_angle;
  },
  onUpdate: (ctx) => {
    const bb = ctx.blackboard;
    bb.__dir_elapsed += ctx.delta;
    if (bb.__dir_elapsed >= bb.__dir_timer) { /* pick a new target heading */ }
    bb.__dir_angle = lerpAngle(bb.__dir_angle, bb.__dir_target, DIR_LERP_SPEED * ctx.delta);
    bb.__vel_x = BEEBLE_SPEED * Math.sin(bb.__dir_angle);   // ← this is "movement"
    bb.__vel_z = BEEBLE_SPEED * Math.cos(bb.__dir_angle);
    bb.__vel_y = undefined;                                  // gravity
    bb.__yaw = bb.__dir_angle;                               // ← this is "facing"
  },
  transitions: [
    { trigger: "player-visible", target: "alert" },
    { trigger: "idle-look", target: "idle-look" },
  ],
},
```

Stopping is just writing zero velocity (the `alert` state does exactly that
and switches to the `idle` clip). Turning toward the player is lerping
`__yaw`. Flying up is writing `__vel_y` (the `ascending` state ramps it from 0
to 8 u/s). A scene-only effect like the sphere-inflate lives in `onEnter`
behind the `groupRef` guard and returns a cleanup.

`onEnter` may return a function; it runs when the state is left (the beeble
uses it to dispose the inflate).

### What `ctx` gives you

`ctx.positionRef.current` (your position), `ctx.playerPosition` and
`ctx.playerDistanceSq` (the nearest player — on the server that is whoever is
closest, so no client is special), `ctx.delta` (seconds since last tick),
`ctx.elapsed`, `ctx.stateElapsed`, `ctx.blackboard`, `ctx.groupRef`.

### Wiring a NEW NPC

1. **Body spec** — `src/objects/actors/<name>/spec.ts`:
   `export const X_COLLIDER = { shape: "capsule", radius: 0.5, height: 2.4 }`.
   Both the client descriptor and the server read this one object.
2. **State machine** — `src/objects/actors/<name>/stateMachine.ts` following
   the contract above.
3. **Client component** — copy `beeble/Beeble.tsx` (~60 lines): it wires
   `useStateMachine`, `useMouseEvents`, and copies the blackboard velocity into
   `ctx.move`. Then `actor.tsx` with the descriptor:
   `body: "kinematic", collider: X_COLLIDER, movement: "ground"` (or
   `"free"` for a flyer), and mount it in a biome's `<Actors>`.
4. **Server** — one line in `server/src/game/entities/kinds.ts`:
   `"<descriptor id>": { sm: X_SM, body: X_COLLIDER }`.

That's the whole job. Terrain, buildings, poles, player collision, publishing,
interpolation and animation sync are all inherited.

### Testing it without a browser

`server/test/entities.test.ts` runs the real beeble machine on a real physics
world: register the NPC, tick the manager, assert on `e.x/e.z/e.sm/e.clip`.
Copy one of those tests for a new NPC. `npm run physics:demo` in `server/`
drops a capsule on real terrain and walks slopes if you change movement rules.

---

## 7. Where things live

| what | where |
|---|---|
| beeble behavior (THE file to edit) | `src/objects/actors/beeble/stateMachine.ts` |
| beeble body spec | `src/objects/actors/beeble/spec.ts` |
| beeble client component / descriptor | `src/objects/actors/beeble/Beeble.tsx`, `actor.tsx` |
| state machine core (runs on both sides) | `src/objects/actors/state/runner.ts`, `triggers.ts`, `types.ts` |
| movement rules (player AND every NPC) | `src/physics/characterMovement.ts` |
| server: which kinds are simulated | `server/src/game/entities/kinds.ts` |
| server: tick orchestration, registration, input | `server/src/game/entities/manager.ts` |
| server: what gets sent | `server/src/game/entities/publish.ts` |
| server: an NPC's body, holds, fix-ups | `server/src/game/physics/npc.ts` |
| server: the physics world, terrain, obstacles, hulls | `server/src/game/physics/world.ts`, `chunks.ts`, `terrain.ts`, `obstacles.ts`, `buildings.ts` |
| client: snapshot buffer | `src/net/entities/entityStore.ts` |
| client: interpolation (unit-tested) | `src/net/entities/interpolation.ts` |
| client: draws the pose / registers | `src/objects/actors/Actor.tsx` (`useSyncedEntity`) |
| client: clip sync, collision capsule | `src/objects/actors/ModelActor.tsx`, `kinematicMover.tsx` |
| wire format | `server/src/protocol.ts` = `src/net/protocol.ts` (change both) |

## 8. Debugging

- Browser console, filter `[sync]`: `server moved <id> by Xu in one update`
  means the server's own track jumped (restart, respawn, backstop lift);
  `session reset` means a reconnect re-registered everything (a server restart
  puts NPCs back at spawn — `tsx watch` restarts on every save).
- Server console every 10s: `[physics] npcs … tick max … step … work …
  colliders … queue …`; a tick over 50ms warns.
- `__entities.list()` in the browser console lists every registered entity
  with its server state and position.
- Remember: dotcomma.io runs the last deployed release. Uncommitted work only
  exists at `localhost:3000` (`npm run dev`).
