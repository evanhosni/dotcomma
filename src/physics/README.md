# Character movement

## How it works

[characterMovement.ts](characterMovement.ts) is the one movement resolver for every kinematic capsule: the local [Player](../player/) and every ground NPC on the server ([server/src/game/physics/walker.ts](../../server/src/game/physics/walker.ts)). It imports only Rapier types, so the server can bundle it.

The caller passes a direction, speed and jump flag; `stepCharacter` sets the body's next kinematic translation and fills a `CharacterStepResult`. Each step:

- **Ground probe**: a downward ray with slope-adaptive reach decides walkable support (Rapier's grounded flag alone is unreliable).
- **Slopes**: full speed below `SLOPE_SOFT_START`, uphill input fades out toward `SLOPE_SOFT_END`, sliding down the fall line above `SLOPE_SLIDE_ANGLE`. Both responses need leaky persistence (`SLOPE_ENGAGE_DELAY`, `SLIDE_ENGAGE_DELAY`).
- **Gravity / jump**: `GRAVITY`, `JUMP_IMPULSE`, `TERMINAL_VELOCITY`; gravity resets only on ray-confirmed support, fall speed is capped near ground (`NEAR_GROUND_FALL_SPEED_CAP`); `vyOverride` lets an NPC set its own vertical speed.
- **Anti-tunneling**: the solve is substepped to `MAX_SUBSTEP_DISTANCE` with `CONTROLLER_CONTACT_OFFSET`.

## How to add another

N/A — one shared resolver; a new capsule uses `createCharacter`, `createStepResult`, `stepCharacter` per frame and `disposeCharacter` on unmount (NPCs just set `movement: "ground"` in their spec).

Tune `GRAVITY`, `JUMP_IMPULSE`, `TERMINAL_VELOCITY` and the `SLOPE_*` / `SLIDE_*` constants; they affect the player and every server NPC.
