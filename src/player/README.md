# Player

## How it works

The local first-person player is [Player.tsx](Player.tsx). `CustomCanvas` mounts it **once** for the life of the page, so it survives domain switches. It is a kinematic capsule ([spec.ts](spec.ts): `PLAYER_HEIGHT` 2, `PLAYER_RADIUS` 0.5) under `<PointerLockControls>`.

Each frame (`useFrame` priority −3, so it runs before the network sync at −2):

1. **Input**: [useInput.tsx](useInput.tsx) keeps a ref of held keys. WASD moves, Shift sprints, Space jumps, Ctrl descends in noclip. The move direction is the camera's flattened forward/side vectors.
2. **Hold at spawn**: while `terrainLoaded` is false (GameContext), the capsule is pinned at the domain's `playerSpawn` plus the server-assigned spawn offset. This is how domain switches and fast travel carry the player to a new place: the ground is built first, then the player is released.
3. **Move**: noclip flies freely (`DEV_*` speeds). Otherwise `stepCharacter(...)` from [physics/characterMovement.ts](../physics/characterMovement.ts) does ALL movement resolution (slopes, gravity, jump, sliding). The same code moves server NPCs.
4. **Safety nets** (all async, all against the analytic terrain height from `world/terrain/vertexData.ts`):
   - **Backstop**: every 3 frames. If the capsule is more than 2u below the surface, it is lifted onto it. Physics can briefly miss the ground during LOD swaps.
   - **Stuck escape**: if input has been held for ~0.2s with no movement and the capsule is slightly embedded, it is lifted.
   - **Fall reset**: below y = −500, respawn 10u above the ground.
   - `resolveEmbeddedSurface` checks the cheap raw height first, then confirms with the padded height. Flatten pads under buildings can dig below the raw height, so the cheap check alone would teleport players out of buildings.
5. **Camera** eases to the capsule top. `playerPosition` (GameContext) is updated for streaming, the address bar and networking.

Network publishing of the player is separate: [net/players/LocalPlayerSync.tsx](../net/players/LocalPlayerSync.tsx).

## How to use/add

N/A (one global player). Knobs:

- Walk/sprint speed: `WALK_SPEED` / `SPRINT_SPEED` in [Player.tsx](Player.tsx). Noclip speeds: `DEV_*` in the same file.
- Gravity, jump, slopes: [physics/characterMovement.ts](../physics/characterMovement.ts). They are shared with the server, so changing them changes NPCs too.
- Capsule size: [spec.ts](spec.ts). Remote players and the server's player bodies read it too.
- Camera far plane: `CAMERA_FAR` in [constants.ts](constants.ts). The terrain LOD rings are sized against it, so change them together.
- New key binding: add the `KeyboardEvent.code` → action pair to `KeyAction` and a field to `InputState` in [useInput.tsx](useInput.tsx).
- Noclip / physics debug: press F1 for devmode, then use the checkboxes (see [context/](../context/)).
