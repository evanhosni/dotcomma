# Player

## How it works

[Player.tsx](Player.tsx) is the first-person kinematic capsule (size in [spec.ts](spec.ts): `PLAYER_HEIGHT`, `PLAYER_RADIUS`) under pointer-lock controls, mounted once by `CustomCanvas` so it survives domain switches. Each frame:

1. **Input**: [useInput.tsx](useInput.tsx) keeps held keys (`InputState`, `KEY_BINDINGS`); movement follows the camera's flattened axes.
2. **Hold at spawn**: while `terrainLoaded` is false the capsule is pinned `SPAWN_DROP_HEIGHT` (100u) above `playerSpawn` (GameContext), then falls once the ground exists — so a spawn inside a building lands on it, never inside it. This is how domain switches and fast travel move the player.
3. **Move**: noclip flies freely; otherwise `stepCharacter` from [physics/characterMovement.ts](../physics/characterMovement.ts) resolves all movement at `WALK_SPEED` / `SPRINT_SPEED`. [waterProbe.ts](waterProbe.ts) samples the water surface under the player every few frames (the same pipeline that draws it, on the dressing worker) and passes it as the step's `swim` input: once `SWIM_SUBMERGED_FRACTION` of the capsule is under, the player sinks slowly, a held Space swims up and floats the head at the surface, and a fresh press with the head near the surface breaches out (`SWIM_*` in characterMovement.ts).
   The camera's depth under that surface drives the underwater pass ([vfx/underwater.ts](../vfx/underwater.ts), `setCameraWaterDepth`, with the liquid's look: a tunnel's sewage or its water).
   **Underground** ([undergroundMode.ts](undergroundMode.ts), `useUndergroundMode`, run before the step): whether the player is in a cave or sewer and what the terrain heightfields are to it there (the step's `ignoreTerrain`: overhead terrain is not ground), plus the manholes' catch, drop, climb (`vyOverride`) and exit. Inside, the tunnels' green liquid is the water. How the tunnels work: [objects/dressing/underground](../objects/dressing/underground/README.md).
4. **Safety nets** ([groundSafetyNets.ts](groundSafetyNets.ts), `useGroundSafetyNets`) against the analytic terrain height: a periodic backstop that lifts the capsule if it is below the surface, a stuck escape, and a fall reset. The backstop and the stuck escape are suspended while the player is in a tunnel (under the ground on purpose). In a tunnel, `undergroundMode.ts` has its own two: a capsule whose axis is in the rock beside it is pushed out along the tunnel field's gradient the same frame, and feet sunk under a floor are set back on the air over it (the underground README, "The player"). `resolveEmbeddedSurface` reads the PADDED height (pads excavate, so a raw one would lift a player out of a building's excavation). Every frequent sample, these and the water probe's, runs on the dressing worker (`getVertexSample`), one in flight each: on the main thread a new cell's first sample built its river list and road network, 20–70ms frames while flying (PERFORMANCE.md).
5. **Camera** follows the capsule; `playerPosition` (GameContext) is updated for streaming, the address bar and networking ([net/players/LocalPlayerSync.tsx](../net/players/LocalPlayerSync.tsx)).

## How to add another

N/A — there is one global player.

Tune `WALK_SPEED` / `SPRINT_SPEED` ([Player.tsx](Player.tsx)), the capsule in [spec.ts](spec.ts), `CAMERA_FAR` ([constants.ts](constants.ts), sized with the terrain LODs), and key bindings in `KEY_BINDINGS` ([useInput.tsx](useInput.tsx)).
