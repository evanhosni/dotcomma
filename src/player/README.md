# Player

## How it works

[Player.tsx](Player.tsx) is the first-person kinematic capsule (size in [spec.ts](spec.ts): `PLAYER_HEIGHT`, `PLAYER_RADIUS`) under pointer-lock controls, mounted once by `CustomCanvas` so it survives domain switches. Each frame:

1. **Input**: [useInput.tsx](useInput.tsx) keeps held keys (`InputState`, `KEY_BINDINGS`); movement follows the camera's flattened axes.
2. **Hold at spawn**: while `terrainLoaded` is false the capsule is pinned `SPAWN_DROP_HEIGHT` (100u) above `playerSpawn` (GameContext), then falls once the ground exists — so a spawn inside a building lands on it, never inside it. This is how domain switches and fast travel move the player.
3. **Move**: noclip flies freely; otherwise `stepCharacter` from [physics/characterMovement.ts](../physics/characterMovement.ts) resolves all movement at `WALK_SPEED` / `SPRINT_SPEED`. [waterProbe.ts](waterProbe.ts) samples the water surface under the player every few frames (the same pipeline that draws it) and passes it as the step's `swim` input: once `SWIM_SUBMERGED_FRACTION` of the capsule is under, the player sinks slowly, a held Space swims up and floats the head at the surface, and a fresh press with the head near the surface breaches out (`SWIM_*` in characterMovement.ts).
   The camera's depth under that surface drives the underwater pass ([vfx/underwater.ts](../vfx/underwater.ts), `setCameraWaterDepth`).
4. **Safety nets** ([groundSafetyNets.ts](groundSafetyNets.ts), `useGroundSafetyNets`) against the analytic terrain height: a periodic backstop that lifts the capsule if it is below the surface, a stuck escape, and a fall reset. `resolveEmbeddedSurface` confirms the cheap raw height with the padded height before acting.
5. **Camera** follows the capsule; `playerPosition` (GameContext) is updated for streaming, the address bar and networking ([net/players/LocalPlayerSync.tsx](../net/players/LocalPlayerSync.tsx)).

## How to add another

N/A — there is one global player.

Tune `WALK_SPEED` / `SPRINT_SPEED` ([Player.tsx](Player.tsx)), the capsule in [spec.ts](spec.ts), `CAMERA_FAR` ([constants.ts](constants.ts), sized with the terrain LODs), and key bindings in `KEY_BINDINGS` ([useInput.tsx](useInput.tsx)).
