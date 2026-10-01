# Menus and overlays

## How it works

HUD panels in [overlay/](overlay/), plain DOM over the canvas:

- [Overlay.tsx](overlay/Overlay.tsx): devmode stats; mounted inside the canvas ([world/CustomCanvas.tsx](../world/CustomCanvas.tsx)) because it reads `gl.info` in `useFrame`.
- [DevOverlay.tsx](overlay/DevOverlay.tsx): one checkbox per `DEV_TOGGLES` entry ([context/constants.ts](../context/constants.ts)).
- [LogsOverlay.tsx](overlay/LogsOverlay.tsx): captured console output (devmode only).
- [NetOverlay.tsx](overlay/NetOverlay.tsx): connection status and players here.

The last three mount in [index.tsx](../index.tsx). Bottom-left panels share one column from `getOrCreateLeftColumn()` ([overlayContainer.ts](overlay/overlayContainer.ts)). Imperative panels update text nodes directly so per-frame numbers never re-render React. Shared style lives in [overlay/styles.ts](overlay/styles.ts): `PANEL_STYLE`, `PANEL_CSS`, `FONT_CSS`, `FONT`, `HUD_COLOR`, `PANEL_BACKGROUND`, `HUD_Z_INDEX` — use them instead of retyping values.

## How to add another

1. Create `overlay/<Name>Overlay.tsx` using the shared styles (copy [NetOverlay.tsx](overlay/NetOverlay.tsx) for a UI-rate panel, or [DevOverlay.tsx](overlay/DevOverlay.tsx) for an imperative bottom-left panel via `PANEL_CSS` + `getOrCreateLeftColumn()`).
2. Mount it in [index.tsx](../index.tsx), or inside `PreCustomCanvas` in [world/CustomCanvas.tsx](../world/CustomCanvas.tsx) if it needs `useThree`/`useFrame`.
3. Never set React state per frame; write text nodes through refs.
4. Clickable controls need `pointer-events: auto` and must `stopPropagation` (pointer-lock controls listen on the document).
