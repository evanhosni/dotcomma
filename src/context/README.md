# Contexts

## How it works

Two React contexts. The types are in [types.ts](types.ts).

- **[GameContext.tsx](GameContext.tsx)** is mounted inside the canvas ([world/CustomCanvas.tsx](../world/CustomCanvas.tsx)) and persists across domain switches.
  - `playerPosition`: a **mutable** `THREE.Vector3` the Player writes every frame. Read it in `useFrame`, never as a render dependency.
  - `terrainLoaded` / `progress`: the terrain gate. `TerrainRenderer` sets them (on the home page, `HomeGround` does). The Player holds at spawn until `terrainLoaded`. `ActorPool` and foliage wait for `progress`.
  - `playerSpawn`: the feet position from `<Domain playerSpawn>`, or from fast travel. `null` = the default sky drop.
- **[DevContext.tsx](DevContext.tsx)** is mounted at the root ([index.tsx](../index.tsx)).
  - `devMode`: toggled with F1 and mirrored to `?devmode` so a refresh keeps it.
  - `noclip`, `physicsDebug`: the devmode checkboxes. Turning devmode off resets them.

Day/night has no context: read the module-level getters in [lighting/dayNight.ts](../lighting/dayNight.ts) from `useFrame`.

## How to use/add

- **Read**: `const { terrainLoaded, playerPosition } = useGameContext();` or `const { devMode } = useDevContext();`.
- **Add a dev toggle**:
  1. Add the field and its setter to `DevContextType` in [types.ts](types.ts).
  2. Add a `useState` in `DevContextProvider`, put it in the memoized value, and reset it in `toggleDevMode` when devmode turns off.
  3. Add one `TOGGLES` entry (`label`, `flag`, `set`) in [menus/overlay/DevOverlay.tsx](../menus/overlay/DevOverlay.tsx) — the checkbox and its sync come with it.
- **Add game-wide state**: add it to `GameContextType` + `GameContextProvider`. Anything that changes per frame must be a ref or a mutable object, not `useState`, or every consumer re-renders every frame.
