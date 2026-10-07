# Bridges

## How it works

Every road that enters a river's footprint (channel plus banks) is carried on a deck from dry road to dry road. Roads and rivers are analytic, so decks are found geometrically, never by probing terrain. Bridges are dressing: built per chunk, no per-bridge component.

**Placement** ([../../../utils/workers/bridges/](../../../utils/workers/bridges), entry `getFreewayBridges` in `freewayBridges.ts`, served by the `bridges` enumerator):
1. `roadPaths.ts` — samples every nearby road (inter-city runs, city belts, arterials) on a fixed lattice.
2. `wetItems.ts` — each wet stretch of a path becomes a candidate deck, extended onto dry road (landed ends) or left open where the road ends in water; open ends join end-to-end or tee onto another deck, and unresolved ones drop their chain.
3. `rules.ts` / `deckBuilder.ts` — `BRIDGE_MIN_CROSSING`, `BRIDGE_MAX_ALONG_SHORE`, `BRIDGE_MAX_TURN`, `BRIDGE_MIN_T_ANGLE`; a road that fails gets no deck.
4. `crossings.ts` / `mouths.ts` — extra street decks across city rivers (every `FILL_STEP`) and at freeway mouths.
5. `deckBuilder.ts` / `finishDeck.ts` — only chains whose midpoint is in the queried chunk are built (that chunk owns them); the window widens through `BRIDGE_WINDOWS` when needed. `finishDeck.ts` and `wallJoins.ts` open and join parapets where decks merge.

Shared deck shape is `deckGeometry.ts`, slab tests `drawnSlab.ts`, the road in front of a landed end (its approach and its mouth) `deckMouth.ts`, constants `constants.ts`, the result type `FreewayBridge` in `types.ts`.

**Terrain**: `deckGround.ts` (via `getFreewayBridgesNear`) cuts the ground under each deck, sets `underDeck` (keeps grass and actors out) and lays each landed end's flat approach (`approachHeight`, `bridgeApproachAt` in `deckMouth.ts`; ramp `bridgeRampAt` in `deckGeometry.ts`).

**This folder**:
- [bridgeSpec.ts](bridgeSpec.ts) — Three-free dimensions and builders: `bridgeRibbon` (slab + parapets as one lofted ribbon), `bridgePierColumns`, `bridgeColliderPoints`; `BRIDGES_SPEC` feeds client and server colliders.
- [Bridges.tsx](Bridges.tsx) — `useSolidDressing`; per chunk one ribbon mesh (`buildDeckRibbonMesh`), one pier mesh (`buildPierMesh`), colliders within `DEFAULT_COLLIDER_DISTANCE`. Mounted once in the city biome; covers bridges everywhere.
- [deckMaterial.ts](deckMaterial.ts) — the deck looks like the city road it carries.

## How to add another

N/A — every road/river crossing gets a deck automatically.

Tune: `BRIDGE_DECK_THICKNESS`, `BRIDGE_PARAPET_HEIGHT`, `BRIDGE_PIER_SIZE` ([bridgeSpec.ts](bridgeSpec.ts)); `DEFAULT_BRIDGE_PLACEMENT` and the `BRIDGE_*` rules (`utils/workers/bridges/constants.ts`); `DEFAULT_RENDER_DISTANCE` / `DEFAULT_COLLIDER_DISTANCE` ([Bridges.tsx](Bridges.tsx)).
