# Contexts

## How it works

Two React contexts; types in [types.ts](types.ts).

- [GameContext.tsx](GameContext.tsx) (`GameContextProvider`, mounted in [world/CustomCanvas.tsx](../world/CustomCanvas.tsx), persists across domain switches):
  - `playerPosition`: a mutable vector the Player writes every frame — read it in `useFrame`, never as a render dependency.
  - `terrainLoaded` / `progress`: the terrain gate; the Player holds at spawn until `terrainLoaded`.
  - `playerSpawn`: the spawn position from `<Domain>` or fast travel.
- [DevContext.tsx](DevContext.tsx) (mounted in [index.tsx](../index.tsx)):
  - `devMode`, toggled by the F1 key and mirrored to `?devmode`.
  - one boolean per `DEV_TOGGLES` entry ([constants.ts](constants.ts)) plus `setToggle`; all reset when devmode turns off.

Read with `useGameContext()` / `useDevContext()`.

## How to add another

- **Dev toggle**: append `{ flag, label }` to `DEV_TOGGLES` in [constants.ts](constants.ts). The checkbox and state come with it; read it via `useDevContext()`.
- **Game-wide state**:
  1. Add the field to `GameContextType` in [types.ts](types.ts).
  2. Provide it in `GameContextProvider` ([GameContext.tsx](GameContext.tsx)). Per-frame values must be refs or mutable objects, not `useState`.
