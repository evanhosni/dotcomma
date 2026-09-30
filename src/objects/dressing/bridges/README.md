# Bridges

## How it works

Every road that enters a river's footprint (the channel plus its banks) is carried on a deck from
dry road on one bank to dry road on the other. Roads and rivers are both computed analytically, so
decks are found geometrically: nothing probes the terrain to find them. Bridges are DRESSING: they
have no per-bridge component and are built per 256u chunk.

**Placement** ([`utils/workers/bridges/`](../../../utils/workers/bridges), entry
[`freewayBridges.ts`](../../../utils/workers/bridges/freewayBridges.ts) `getFreewayBridges`, served by
the `bridges` entry of [`../enumerators.ts`](../enumerators.ts)), one module per step:
1. **Road paths** (`roadPaths.ts`). Every road near a river is sampled on a fixed lattice, so every
   chunk samples it the same way. That covers the inter-city runs, each city's belt and the city
   arterials.
2. **Wet items** (`wetItems.ts`). Each stretch of a path inside a river footprint becomes a candidate deck,
   extended onto the dry road on both sides (*landed* ends). Where the road itself ends in the
   water, the end is *open*.
3. **Joins** (`wetItems.ts`). Open ends that meet end-to-end become one chain if the join is nearly straight. An
   open end beside another deck's middle becomes a T onto it. An open end with nothing there
   drops its chain.
4. **Rules** (`rules.ts`, applied in `deckBuilder.ts`). A deck must cross a river centerline at no less than `BRIDGE_MIN_CROSSING` (40°),
   must not follow the shore for longer than `BRIDGE_MAX_ALONG_SHORE`, and must not turn more than
   `BRIDGE_MAX_TURN`. A T must meet its host at no less than `BRIDGE_MIN_T_ANGLE`. A road that
   fails the rules gets no deck; in a city it ends at the quay.
5. **Crossings of their own** (`crossings.ts`, `mouths.ts`): city rivers also get street-width
   decks at least every `FILL_STEP` (350u), and every freeway mouth that reaches a river gets a deck.
6. Decks are built lazily (`deckBuilder.ts`, finished in `finishDeck.ts`): only the chains whose
   midpoint is in the queried chunk. That chunk owns the deck. The search window grows through
   `BRIDGE_WINDOWS` only when a chain touches the window's edge.

The deck's shape every consumer lofts (ramps, arch, stations, cross-sections, crotch fillets) is
`deckGeometry.ts`; where a world point lies against the drawn slab is `drawnSlab.ts`; shared
dimensions and rule thresholds are `constants.ts`, the types `types.ts`. `severed.ts` is the
census tests and probes use: every freeway stretch a river severs.

A `FreewayBridge` carries its midpoint, end heights, world `path`, `width`, `camber` (arch),
`piers`, parapet `gaps` and lane `paint`. The gaps (`finishDeck.ts`) keep every wall on the OUTER edge
of merged decks: a wall opens over pavement, wherever it lies inside another merged deck's drawn slab
(fillets included), and where only a stub under 4u would be left. The lane paint continues each landed
end's road at that road's dash rate (`bridgeLaneAlong`).

**Terrain interplay.** `computeVertexData` step 7 (`utils/workers/bridges/deckGround.ts`) asks
`getFreewayBridgesNear` for every deck reaching its cell and cuts the ground under exactly those
decks, just below the deck top. `VertexResult.underDeck` keeps grass and actors out from under
them. A landed end ramps into the road (`bridgeRampAt`); a landed CUT end meets it flush, and between the
cut and the road's asphalt the ground paints as asphalt, across the deck's width only where that road
lies ahead (`bridgeMouthFieldAt` in `drawnSlab.ts`), so no curb, sidewalk or sand shows at the seam and
the road's curb beside the deck stays where it was.

**Rendering and colliders** (this folder):
- [`bridgeSpec.ts`](bridgeSpec.ts): Three-free. Deck thickness, parapet height and pier size,
  `BRIDGE_PLACEMENT`, and the geometry builders: `bridgeRibbon` (the slab and two parapets lofted
  along the path as one ribbon), `bridgePierColumns` (up to the drawn slab's underside), and
  `bridgeColliderPoints` (one body per chord with a triangle mesh of exactly what the ribbon draws
  there: the slab and each standing wall). `BRIDGES_SPEC` (listed in [`../catalog.ts`](../catalog.ts)) is what the
  client and the server (`server/src/game/physics/obstacles.ts`) both build colliders from.
- [`Bridges.tsx`](Bridges.tsx): the dressing component. Per chunk it builds ONE merged ribbon mesh
  (relative to the chunk center for float precision), one instanced mesh of piers, and colliders
  within `BRIDGE_COLLIDER_DISTANCE` (140u). It is mounted once, in the city biome
  (`world/domains/overworld/regions/city/biomes/city/biome.tsx`), and covers bridges outside the
  city too.
- [`deckMaterial.ts`](deckMaterial.ts): the deck looks like the terrain's city road (same texture
  tiling, gutters, dashed lanes, fake shading, night dim, lamp glow), so it reads as the road
  carried over the river. It is drawn a few depth steps toward the camera (`polygonOffset`): the ground
  under a deck's ends lies only 0.08u below its top, and far away the depth buffer let it win.

## How to use/add

N/A. Every road/river crossing gets a deck automatically, and new roads and rivers are picked up
without changes. Knobs:
- Deck look: `BRIDGE_DECK_THICKNESS`, `BRIDGE_PARAPET_HEIGHT`, `BRIDGE_PIER_SIZE` in
  [`bridgeSpec.ts`](bridgeSpec.ts). Colors are in [`deckMaterial.ts`](deckMaterial.ts).
- Placement: `DEFAULT_BRIDGE_PLACEMENT` in `utils/workers/bridges/constants.ts` (`abutment`,
  `archChance`, `maxCamber`, `pierSpacing`, `pierLateral`). Change it there, not at the `<Bridges/>`
  mount: the terrain cut and the server read the default, and a mount override would draw decks
  the ground was not cut for.
- Which crossings get decks: the `BRIDGE_*` rule constants in `utils/workers/bridges/constants.ts`
  (and each step module's own), and the matching `RIVER_ROAD_*` constants in
  `utils/workers/rivers/riverRoadLayer.ts`, which decide where a river yields to a road instead.
- Distances: `BRIDGE_RENDER_DISTANCE` / `BRIDGE_COLLIDER_DISTANCE` in [`Bridges.tsx`](Bridges.tsx), or
  `renderDistance` / `colliderDistance` on the `<Dressing>` group.
- Tests: [`bridgeSpec.test.ts`](bridgeSpec.test.ts), `utils/workers/bridges/bridgeRules.test.ts`,
  `bridges/deckGround.test.ts`, `bridges/deckMouth.test.ts`, `bridges/severedFreeways.test.ts`, `roads/cityFeatures.test.ts`.
