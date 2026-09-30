# Addresses and fast travel

## How it works

In the overworld, **the URL is a place**. Every path except `/` is an address. The address bar follows the player, and opening a link teleports you there.

**Path forms** (parsed by `parseAddressPath` in [address.ts](address.ts)):

| path | means |
|---|---|
| `/famous-sprawl/velvet-town` | a region cell (word name) + a biome cell (word name). Travel lands on the biome cell's site |
| `/famous-sprawl` | a region cell. Travel lands on the biome cell under that region cell's site |
| `/city` | a region TYPE (a region spec's `name`): its cell nearest the world origin, the same place for everyone |
| `/snow/mountain` | a region type + a biome type: the nearest `mountain` cell to that region cell's site |

If a path doesn't resolve, the player lands at the biome cell containing the origin.

**Names are coordinates, not hashes.** `encodeCell` turns a grid cell `(ix, iz)` into words, and `decodeWords` reverses it exactly. The steps: zigzag, bit-interleave, scramble the low 12 bits with a fixed odd multiplier, then split into base-256 **adjective** digits followed by one base-16 **noun** digit. Nothing is stored. A place nobody has visited still decodes.
- Names are 2 words within ±32 cells of the origin, 3 words within ±512, and 4 beyond.
- The noun comes from the **theme list** of whatever stands there: `REGION_NOUNS` / `BIOME_NOUNS`, keyed by the region's / biome's `name` (so a region and a biome may share a name — `city` is both). A name with no list uses `GENERIC_NOUNS`.
- Every noun is unique across all lists, so a noun decodes from any theme. The theme changes the word, never the place.

**FROZEN.** These decide which words mean which place: the word lists and their order, `SCRAMBLE`, `OVERWORLD_SEED` ([config.ts](config.ts)), the region and biome order, and the grid sizes. Lists are append-only. [address.test.ts](address.test.ts) pins fixed vectors (`amber-lagoon` = cell 0,0). If a vector fails, every link ever shared has moved.

**[FastTravel.tsx](FastTravel.tsx)** is the React glue, mounted in [domain.tsx](domain.tsx):
- On mount, and on every `ADDRESS_TRAVEL_EVENT` from [../navigation.ts](../navigation.ts), it takes the pending address and resolves it (`resolveAddress`). It then closes the terrain gate (`terrainLoaded` false) and sets `playerSpawn` on the ground, or on the water surface if the site is in a lake. The Player holds at that spawn until the terrain there is built.
- Once per second it asks the dressing worker which place the player is in (`getPlaceInfo`) and `replaceState`s the canonical path (`pathForPlace`).
- Debug: in the browser console, `window.__dotcomma.travelTo(x, z)` teleports to raw world coordinates.

`resolveAddress` needs the main-thread height pipeline initialized (`ensureVertexCompute()` from `world/terrain/vertexData.ts`). FastTravel awaits that for you.

## How to use/add

**Link to a place:** call `navigateToAddress("/desert")` (from `../navigation.ts`) inside a user gesture handler, or put the path in a CRT page ([../home/README.md](../home/README.md)). To get the current place's canonical path, read the address bar.

**Give a new region or biome its own nouns** (optional; without a list its names use `GENERIC_NOUNS`) — one edit:
1. In [address.ts](address.ts), add a 16-word list to `REGION_NOUNS` or `BIOME_NOUNS` keyed by the spec's `name`. Words are lowercase, and none may appear in any other list or in `ADJECTIVES`: the module throws at load on a wrong length or any repeated word.
2. Check with `npm test -- --watchAll=false address` (set `CI=true` first; in PowerShell, `$env:CI="true"`).

Never reorder or edit existing words, and never change `SCRAMBLE`.
