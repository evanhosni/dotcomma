# Contexts

## How it works

Two React contexts; types in [types.ts](types.ts).

- [GameContext.tsx](GameContext.tsx) (`GameContextProvider`, mounted in [world/CustomCanvas.tsx](../world/CustomCanvas.tsx), persists across domain switches):
  - `playerPosition`: a mutable vector the Player writes every frame — read it in `useFrame`, never as a render dependency.
  - `terrainLoaded` / `progress`: the terrain gate; the Player holds at spawn until `terrainLoaded`.
  - `playerSpawn`: the spawn position from `<Domain>` or fast travel.
- [DevContext.tsx](DevContext.tsx) (mounted in [index.tsx](../index.tsx)):
  - `devMode`: the saved setting `settings.devmode` (save/), synced with the URL: at load `?devmode=true` turns it on and `?devmode=false` or no param turns it off (the save follows); F1 with devmode off turns it on (with it on, F1 is the noclip toggle), the devmode panel's × turns it off (`setDevMode`), and the URL follows either way.
  - one boolean per `DEV_TOGGLES` entry ([constants.ts](constants.ts)) plus `setToggle`. Each entry's `key` (F1 = noclip, F2 = physics debug, …) flips it while devmode is on, unmodified only (Ctrl+F5 still reloads). The selection is saved to the device (`devmode` in [save/](../save/README.md)) on every change. While devmode is off, every flag reads false, but the selection is kept, so devmode comes back with it.

Read with `useGameContext()` / `useDevContext()`.

## How to add another

- **Dev toggle**: append `{ flag, label, key }` to `DEV_TOGGLES` in [constants.ts](constants.ts) (`key` = the next free function key). The checkbox, the key binding, the state and its saved value come with it; read it via `useDevContext()`.
- **Game-wide state**:
  1. Add the field to `GameContextType` in [types.ts](types.ts).
  2. Provide it in `GameContextProvider` ([GameContext.tsx](GameContext.tsx)). Per-frame values must be refs or mutable objects, not `useState`.
