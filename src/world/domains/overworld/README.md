# Addresses and fast travel

## How it works

In the overworld the URL is a place: every path except `/` is an address, the address bar follows the player, and opening a link teleports there.

- **Path forms** (`parseAddressPath`, [address.ts](address.ts)): `/<region words>/<biome words>` (a cell pair), `/<region words>`, `/<region type>` (that region's cell nearest the origin), `/<region type>/<biome type>` (the nearest such biome cell). Unresolvable paths land at the origin's cell.
- **Names are coordinates.** `encodeCell` turns a cell `(ix, iz)` into words and `decodeWords` reverses it exactly: zigzag, bit-interleave, scramble with `SCRAMBLE`, then `ADJECTIVES` digits plus one noun. Nothing is stored.
- **Nouns** come from the theme list of what stands there (`REGION_NOUNS` / `BIOME_NOUNS` by spec `name`, else `GENERIC_NOUNS`). Nouns are unique across lists, so the theme changes the word, never the place.
- **FROZEN:** word lists and order, `SCRAMBLE`, `OVERWORLD_SEED` ([config.ts](config.ts)), region/biome order and grid sizes. [address.test.ts](address.test.ts) pins fixed vectors.
- [FastTravel.tsx](FastTravel.tsx): on mount and on `ADDRESS_TRAVEL_EVENT` it resolves the pending address (`resolveAddress`, after `ensureVertexCompute()`), closes the terrain gate and sets `playerSpawn` (on water in a lake). It periodically reads `getPlaceInfo` and `replaceState`s `pathForPlace`. Debug: `window.__dotcomma.travelTo(x, z)`, plus `.camera` and `.scene` for driving a test view from the console without pointer lock.

## How to add another

Give a new region or biome its own nouns (optional):

1. Add a list to `REGION_NOUNS` or `BIOME_NOUNS` in [address.ts](address.ts), keyed by the spec's `name`; lowercase words unique across every list and `ADJECTIVES` (the module throws otherwise).
2. Run `npm test -- --watchAll=false address` with `CI=true`.

Never reorder or edit existing words.
