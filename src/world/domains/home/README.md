# Home domain

## How it works

The landing page at `/`: a flat black world with a huge CRT that selects an overworld address. Wired in [domain.tsx](domain.tsx).

- **No streaming terrain** (`<Domain terrain={false}>`). [HomeGround.tsx](HomeGround.tsx) is a black plane, a lit wireframe grid that follows the camera (snapped to `GRID_SPACING`) and one collider; it sets `terrainLoaded`/`progress` itself.
- **Flat config still commits** (`<Terrain>` with zero noise, the config-only `home` region and `wire` biome in [regions/](regions/)) so the analytic height pipeline reads zero for the Player. Don't remove it.
- **No ambient light**: the grid stays black until the CRT's glow light (parked at zero intensity from mount) turns on.
- [CrtMonitor.tsx](CrtMonitor.tsx): powers on after the first pointer lock; the wheel scrolls pages (`ADDRESS_PAGES` = one `/<region>` page per `OVERWORLD_REGIONS` entry, then `EXTRA_PAGES`, padded with locked pages to `MIN_PAGE_COUNT`). Clicking an unlocked page within `INTERACT_DISTANCE` calls `navigateToAddress(href)`. [crtScreen.ts](crtScreen.ts) draws the page atlas and screen shader; [domainDiorama.ts](domainDiorama.ts) bakes the hand-built thumbnail.
- [ClickToEnter.tsx](ClickToEnter.tsx): HTML gate that swallows clicks until "click to enter", then triggers drei's pointer lock.
- [HomeTitle.tsx](HomeTitle.tsx) + [labelMaterial.ts](labelMaterial.ts): the floating title.

## How to add another

Region pages are automatic. To add another page:

1. Append `{ label, href }` to `EXTRA_PAGES` in [CrtMonitor.tsx](CrtMonitor.tsx); `href` is any overworld address ([../overworld/README.md](../overworld/README.md)). Omit `href` for a locked page.
