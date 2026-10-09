# Character movement

## How it works

[characterMovement.ts](characterMovement.ts) is the one movement resolver for every kinematic capsule: the local [Player](../player/) and every ground NPC on the server ([server/src/game/physics/walker.ts](../../server/src/game/physics/walker.ts)). It imports only Rapier types, so the server can bundle it.

The caller passes a direction, speed and jump flag; `stepCharacter` sets the body's next kinematic translation and fills a `CharacterStepResult`. Each step:

- **Ground probe**: a downward ray with slope-adaptive reach decides walkable support (Rapier's grounded flag alone is unreliable).
- **Slopes**: full speed below `SLOPE_SOFT_START`, uphill input fades out toward `SLOPE_SOFT_END`, sliding down the fall line above `SLOPE_SLIDE_ANGLE`. Both responses need leaky persistence (`SLOPE_ENGAGE_DELAY`, `SLIDE_ENGAGE_DELAY`). A collider tagged a FULL-SPEED SLOPE skips the uphill fade and is climbed at the walk speed ALONG its surface (the solve alone keeps only cos² of an uphill walk). The slide still applies above `SLOPE_SLIDE_ANGLE`. Building ramps are tagged; terrain never is.
- **Gravity / jump**: `GRAVITY`, `JUMP_IMPULSE`, `TERMINAL_VELOCITY`; gravity resets only on ray-confirmed support, fall speed is capped near ground (`NEAR_GROUND_FALL_SPEED_CAP`); `vyOverride` lets an NPC set its own vertical speed.
- **Anti-tunneling**: the solve is substepped to `MAX_SUBSTEP_DISTANCE` with `CONTROLLER_CONTACT_OFFSET`.

## How to make a sloped object walkable at full speed

A FULL-SPEED SLOPE is climbed with no uphill fade. It applies to every capsule, because all of them step through `stepCharacter`: the player, client-local actors (`kinematicMover.tsx`) and every server NPC (`walker.ts`, beebles included). Tag the collider where it is created, by one of three routes:

- **Solid dressing (client AND server):** set `fullSpeedSlope: true` on the `DressingColliderPart` or `DressingColliderMesh` in the feature's Three-free spec. `dressingColliders.tsx` (client) and `server/src/game/physics/obstacles.ts` (server) both tag what they build from it. Use this for anything NPCs must walk.
- **A declarative (R3F) collider:** pass its ref to `useFullSpeedSlope(ref)` ([useFullSpeedSlope.ts](useFullSpeedSlope.ts)). `RampCuboid` in `building/Building.tsx` is the example.
- **Any other imperative collider:** call `markFullSpeedSlope(collider)` on the collider `createCollider` returned, on each side that builds it.

There is no untagging: the tags are a WeakSet of collider objects, so a removed collider drops out by itself. Keep the slope under `SLOPE_SLIDE_ANGLE` (40°) or capsules still slide. A collider only the client builds (building interiors) is only ever walked by the player and client-local actors; server NPCs never meet it.

## How to add another

N/A — one shared resolver; a new capsule uses `createCharacter`, `createStepResult`, `stepCharacter` per frame and `disposeCharacter` on unmount (NPCs just set `movement: "ground"` in their spec).

Tune `GRAVITY`, `JUMP_IMPULSE`, `TERMINAL_VELOCITY` and the `SLOPE_*` / `SLIDE_*` constants; they affect the player and every server NPC.
