# Menus and overlays

## How it works

All HUD panels live in [overlay/](overlay/). They are plain DOM on top of the canvas, not in-world objects.

| panel | where it mounts | shows |
|---|---|---|
| [Overlay.tsx](overlay/Overlay.tsx) | inside the canvas ([world/CustomCanvas.tsx](../world/CustomCanvas.tsx)), because it reads `gl.info` in `useFrame` | devmode stats: FPS / MS / memory graphs, position, biome, draw calls, terrain progress. Backspace resets the held worst values. |
| [DevOverlay.tsx](overlay/DevOverlay.tsx) | [index.tsx](../index.tsx) | the devmode checkboxes, one per entry of its `TOGGLES` list (noclip, physics debug) |
| [LogsOverlay.tsx](overlay/LogsOverlay.tsx) | [index.tsx](../index.tsx) | captured console logs, warnings and errors (devmode only, expire after 30s) |
| [NetOverlay.tsx](overlay/NetOverlay.tsx) | [index.tsx](../index.tsx) | top-right connection status, your color/id, players here (always on) |

- **Devmode** is toggled with F1 and mirrored to `?devmode` in the URL ([context/DevContext.tsx](../context/DevContext.tsx)).
- Bottom-left panels stack in one shared flex column: `getOrCreateLeftColumn()` in [overlayContainer.ts](overlay/overlayContainer.ts).
- The stats, dev and logs panels build their DOM imperatively in a `useEffect` and update text nodes directly, so a changing number never re-renders React. `NetOverlay` is ordinary JSX because it only changes at UI rate.
- The crosshair is not a menu. It lives in [utils/cursor/cursor.ts](../utils/cursor/cursor.ts). The home page's click-to-enter gate lives with the home domain.

### Style rules (every overlay)

The shared pieces are in [overlay/styles.ts](overlay/styles.ts): `PANEL_STYLE` (React style object), `PANEL_CSS` / `FONT_CSS` (cssText strings for imperative DOM), and `FONT`, `HUD_COLOR`, `PANEL_BACKGROUND`, `HUD_Z_INDEX`. Use them instead of retyping values. The rules they encode:


- Font `'Kode Mono', 'Courier New', Courier, monospace`, 12px, line-height 1.5.
- Green on black: text `#0f0`, backgrounds `rgba(0,0,0,0.6)` to `rgba(0,0,0,0.85)`.
- Containers: `border-radius: 4px`, `padding: 8px 12px`, `pointer-events: none` for passive panels.
- Hover/selection `rgba(0,255,0,0.15)`. Inputs: transparent, only a `1px solid #0f0` bottom border, inherit the font. Graphs: `border-radius: 2px`, `rgba(0,0,0,0.4)`.
- `position: fixed`. `z-index: 1000` for HUD, `9999` for modals with a backdrop.
- Inline style objects, not CSS modules.

## How to use/add

### Add an overlay

1. Create `src/menus/overlay/<Name>Overlay.tsx`. For something that updates at UI rate, copy [NetOverlay.tsx](overlay/NetOverlay.tsx):
   ```tsx
   import { HUD_Z_INDEX, PANEL_STYLE } from "./styles";
   const NAME_PANEL_STYLE: React.CSSProperties = { ...PANEL_STYLE, position: "fixed", top: 12, left: "50%", zIndex: HUD_Z_INDEX };
   export const NameOverlay = () => {
     const { devMode } = useDevContext();   // optional: devmode-only
     if (!devMode) return null;
     return <div style={NAME_PANEL_STYLE}>…</div>;
   };
   ```
   For a bottom-left panel built imperatively, set `el.style.cssText = "order:<n>;" + PANEL_CSS` and append it to `getOrCreateLeftColumn()` (see [DevOverlay.tsx](overlay/DevOverlay.tsx)).
2. Mount it:
   - in [index.tsx](../index.tsx) next to `<NetOverlay />` if it only needs React/DOM;
   - inside `PreCustomCanvas` in [world/CustomCanvas.tsx](../world/CustomCanvas.tsx) if it needs `useThree`/`useFrame`.
3. Never set React state every frame. Read per-frame values in `useFrame` and write text nodes through refs (see `Overlay.tsx`).
4. An interactive overlay needs `pointer-events: auto` on its controls. Remember that pointer lock hides the mouse: drei's `PointerLockControls` listens on the whole document, so a clickable overlay must `stopPropagation` its clicks.
