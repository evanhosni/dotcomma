# Home domain

## How it works

The landing page at `/`: a flat black world with a floating title and a huge CRT showing static. Clicking the CRT enters the overworld. Wired in [index.tsx](index.tsx).

- **The ground is the streaming terrain**, flat (`FLAT_NOISE`) and drawn as a wire grid (`<Terrain wireframe>`). Its biome's material is [shaders/fragment.glsl](shaders/fragment.glsl) (built by `crtLitGridMaterial`): the lines are black until the CRT powers on, then lit by its glow. The terrain's own point lighting only runs at night, so the grid computes the glow itself from `CRT_GLOW` and the shared `CRT_POWER` uniform.
- [HomeScreen.tsx](HomeScreen.tsx): the page's HTML, built like the other overlays (menus/overlay) and removed with the domain. A full-page backdrop swallows every click until the pointer first locks (drei's PointerLockControls listens on the DOCUMENT). "- click to enter -" dispatches a synthetic document click: drei locks the element its controls are connected to, while locking one we pick would leave mouse-look dead.
- [crt/](crt/index.tsx): the TV. It powers on into static ([crt/material.ts](crt/material.ts)) a second after the first pointer lock. Its glow light is PARKED at intensity 0 from mount, because a light appearing later recompiles every lit shader. It is solid: one fixed Rapier box around the bezel and the housing, made imperatively. While hovered within `INTERACT_DISTANCE` it claims the crosshair (utils/cursor), and its click calls `enterOverworld()` ([../navigation.ts](../navigation.ts)): the overworld at the biome cell the world origin sits in, dropped from `ENTRY_DROP_HEIGHT` ([../overworld/FastTravel.tsx](../overworld/FastTravel.tsx)) to fall while the map loads. Its placement and glow are [crt/constants.ts](crt/constants.ts).
- [HomeTitle.tsx](HomeTitle.tsx): the floating title (a canvas-text material).
