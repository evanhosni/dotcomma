# Contexts

## How it works

Two React contexts. The types are in [types.ts](types.ts).

- **[GameContext.tsx](GameContext.tsx)** is mounted inside the canvas ([world/CustomCanvas.tsx](../world/CustomCanvas.tsx)) and persists across domain switches.
  - `playerPosition`: a **mutable** `THREE.Vector3` the Player writes every frame. Read it in `useFrame`, never as a render dependency.
  - `terrainLoaded` / `progress`: the terrain gate. `TerrainRenderer` sets them (on the home page, `HomeGround` does). The Player holds at spawn until `terrainLoaded`. `ActorPool` and foliage wait for `progress`.
  - `playerSpawn`: the feet position from `<Domain playerSpawn>`, or from fast travel. `null` = the default sky drop.
- **[DevContext.tsx](DevContext.tsx)** is mounted at the root ([index.tsx](../index.tsx)).
  - `devMode`: toggled with F1 and mirrored to `?devmode` so a refresh keeps it.
  - one boolean per `DEV_TOGGLES` entry ([constants.ts](constants.ts)) — today `noclip`, `physicsDebug` — plus `setToggle(flag, on)`. Turning devmode off resets them all.

Day/night has no context: read the module-level getters in [lighting/dayNight.ts](../lighting/dayNight.ts) from `useFrame`.

## How to use/add

- **Read**: `const { terrainLoaded, playerPosition } = useGameContext();` or `const { devMode } = useDevContext();`.
- **Add a dev toggle** — one line (was 3 files, 4 edits): append `{ flag: "myFlag", label: "my flag" }` to `DEV_TOGGLES` in [constants.ts](constants.ts). The checkbox, its state and its reset when devmode turns off come with it; read it anywhere with `const { myFlag } = useDevContext();` (set it from code with `setToggle("myFlag", on)`).
- **Add game-wide state**: add it to `GameContextType` + `GameContextProvider`. Anything that changes per frame must be a ref or a mutable object, not `useState`, or every consumer re-renders every frame.
