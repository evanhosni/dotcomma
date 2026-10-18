# Contexts

## How it works

Two React contexts; types in [types.ts](types.ts).

- [GameContext.tsx](GameContext.tsx) (`GameContextProvider`, mounted in [world/CustomCanvas.tsx](../world/CustomCanvas.tsx), persists across domain switches):
  - `playerPosition`: a mutable vector the Player writes every frame — read it in `useFrame`, never as a render dependency.
  - `terrainLoaded` / `progress`: the terrain gate; the Player holds at spawn until `terrainLoaded`.
  - `playerSpawn`: the spawn position from `<Domain>` or fast travel.
- [DevContext.tsx](DevContext.tsx) (mounted in [index.tsx](../index.tsx)):
  - `devMode`: on exactly while the URL carries `?devmode` (any value); there is no key for it. Navigation carries the query string through every path change.
  - one boolean per `DEV_TOGGLES` entry ([constants.ts](constants.ts)) plus `setToggle`. Each entry's `key` (F1 = noclip, F2 = physics debug, …) flips it while devmode is on, unmodified only (Ctrl+F5 still reloads). The selection is saved to the device (`devmode` in [save/](../save/README.md)) on every change. While devmode is off, every flag reads false, but the selection is kept, so devmode comes back with it.

Read with `useGameContext()` / `useDevContext()`.

## How to add another

- **Dev toggle**: append `{ flag, label, key }` to `DEV_TOGGLES` in [constants.ts](constants.ts) (`key` = the next free function key). The checkbox, the key binding, the state and its saved value come with it; read it via `useDevContext()`.
- **Game-wide state**:
  1. Add the field to `GameContextType` in [types.ts](types.ts).
  2. Provide it in `GameContextProvider` ([GameContext.tsx](GameContext.tsx)). Per-frame values must be refs or mutable objects, not `useState`.
