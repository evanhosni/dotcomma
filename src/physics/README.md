# Character movement

## How it works

[characterMovement.ts](characterMovement.ts) is **the** movement resolver for every kinematic capsule. The local [Player](../player/) uses it, and so does every ground NPC on the server ([server/src/game/physics/walker.ts](../../server/src/game/physics/walker.ts) runs this same file through the server bundle). That is why it imports only Rapier types: no Three, no React.

The caller hands in a direction, a speed and a jump flag. `stepCharacter` sets the body's next kinematic translation and returns a `CharacterStepResult` (position, grounded/walkable/near-ground flags, ground angle, the desired move for stuck detection).

In one step:

- **Ground probe**: a downward ray every step. Its reach grows with slope (1/cos θ). Rapier's `computedGrounded()` flickers on heightfields, so the ray is the source of truth for "standing on walkable ground".
- **Slopes, three bands**:
  - up to `SLOPE_SOFT_START` (25°): full speed;
  - from 25° to `SLOPE_SOFT_END` (45°): the uphill part of the input fades to 0;
  - above `SLOPE_SLIDE_ANGLE` (40°): the character slides down the fall line.
  Responses engage only after a short, leaky persistence timer (`SLOPE_ENGAGE_DELAY`, `SLIDE_ENGAGE_DELAY`), so one-frame slivers and pad edges don't trigger them.
- **Gravity / jump**: gravity resets only on ray-confirmed walkable support. The fall speed is capped near any ground (`NEAR_GROUND_FALL_SPEED_CAP`). `vyOverride` lets an NPC drive its own vertical speed.
- **Anti-tunneling**: the solve is substepped to ≤ `MAX_SUBSTEP_DISTANCE` per sweep with `CONTROLLER_CONTACT_OFFSET` 0.08. The player adds an analytic-height backstop on top ([player/README](../player/README.md)).

Physics steps once per frame (`timeStep="vary"` in [world/CustomCanvas.tsx](../world/CustomCanvas.tsx)). The measured reasons behind each constant are in the file's comments and [CLAUDE.md](../../CLAUDE.md) under `player/Player.tsx`.

## How to use/add

N/A (global). To move a new kinematic capsule, use the same API the player uses:

```ts
const character = createCharacter(rapier, world, { height: 2, radius: 0.5 });
const out = createStepResult();
// per frame:
stepCharacter(world, character, body, body.collider(0), p.x, p.y, p.z,
  { dirX, dirZ, speed, jump }, Math.min(delta, 0.05), out);
// on unmount:
disposeCharacter(world, character);
```

To move an NPC, you don't call this directly. Give its spec `movement: "ground"` and the server does it (see [NPC_TRACKING.md](../../NPC_TRACKING.md)).

Knobs: `GRAVITY`, `JUMP_IMPULSE`, `TERMINAL_VELOCITY`, and the `SLOPE_*` / `SLIDE_*` constants at the top of [characterMovement.ts](characterMovement.ts). Changing them changes the player AND every server NPC; `GRAVITY` is also the Rapier world gravity on the client ([world/CustomCanvas.tsx](../world/CustomCanvas.tsx)) and the server (`physicsWorld.ts`), both imported from here. Re-measure slopes before moving `SLOPE_SLIDE_ANGLE` (the file header says how).
