# Home domain

## How it works

The landing page at path `/`. The world is flat and black. A huge CRT monitor is the address selector, and clicking a page drops the player into the overworld. [domain.tsx](domain.tsx) wires it together:

- **No streaming terrain.** `<Domain terrain={false}>` skips `TerrainRenderer`. [HomeGround.tsx](HomeGround.tsx) is the ground instead: a black fill plane, a lit white wireframe grid that follows the camera (snapped to `GRID_SPACING`), and one flat collider. Since `TerrainRenderer` is not running, HomeGround sets `terrainLoaded`/`progress` itself; the Player waits on those.
- **The flat config still commits.** `<Terrain>` with zeroed noise and rivers off (`defaultProbability: 0`), plus the `home` region and its config-only `wire` biome ([regions/home/](regions/home/): spec files only, mounted as config-only through `<Regions specs={HOME_REGIONS} components={{ home: null }}>`), keep the analytic height pipeline (Player backstop and respawn) reading height 0. Don't remove them.
- **Zero ambient light.** `DayNightLights` is mounted by the overworld domain only ([../overworld/domain.tsx](../overworld/domain.tsx)), so the grid is black until the CRT's green glow light turns on.
- **[CrtMonitor.tsx](CrtMonitor.tsx)**: powers on about 1s after the first pointer lock. The mouse wheel scrolls its pages: `ADDRESS_PAGES`, one `/<region>` page per region in `OVERWORLD_REGIONS` ([../overworld/regions/index.ts](../overworld/regions/index.ts)), then `EXTRA_PAGES`, padded with locked `???` pages to `MIN_PAGE_COUNT` (7). Clicking a settled, unlocked page within `INTERACT_DISTANCE` calls `navigateToAddress(href)` ([../navigation.ts](../navigation.ts)). The picture is [crtScreen.ts](crtScreen.ts): the page text as a canvas atlas, and the screen shader (curvature, scanlines, flicker, vignette, power-on). The glow light exists from mount at intensity 0, because adding a light later would recompile the lit shaders.
- **[domainDiorama.ts](domainDiorama.ts)**: a hand-built mini landscape (not the real generator), baked once into a 64px texture that serves as page 1's thumbnail.
- **[ClickToEnter.tsx](ClickToEnter.tsx)**: an HTML full-page gate that swallows clicks until "- click to enter -" is clicked, then triggers drei's pointer lock.
- **[HomeTitle.tsx](HomeTitle.tsx)** + [labelMaterial.ts](labelMaterial.ts): the floating "dotcomma" text.

The home domain has no `config.ts`, so the server simulates nothing here.

## How to use/add

**A region's CRT page** needs nothing: every region in `OVERWORLD_REGIONS` gets a `/<name>` page, in list order.

**Add another page** (e.g. a biome address) — one line: append it to `EXTRA_PAGES` in [CrtMonitor.tsx](CrtMonitor.tsx):
```ts
{ label: "/snow/mountain", href: "/snow/mountain" },   // unlocked: travels to that address
```
`href` can be any overworld address: `/<region>`, `/<region>/<biome>`, or a word address ([../overworld/README.md](../overworld/README.md)). Pages without an `href` render as locked.

Knobs:
- Monitor placement: the `position` prop in [domain.tsx](domain.tsx).
- Interaction reach and scroll feel: `INTERACT_DISTANCE`, `SCROLL_COOLDOWN_MS` in CrtMonitor.tsx.
- Grid look: `GRID_SPACING`, `WIRE_SIZE` in HomeGround.tsx.
