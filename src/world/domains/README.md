# Domains

## How it works

A DOMAIN is one switchable world. There are two: `overworld` (THE game, one infinite map — `/` and every
URL path that is an address boot it, into its intro: [overworld/intro/](overworld/intro/README.md)) and
`404` (where every other path lands, rewritten to `/404`).

- **[index.ts](index.ts)** — `DOMAIN_TREES` (each world as the one JSX element it is), `DOMAIN_NODES`
  (each tree read as data), `DOMAIN_CONFIGS` (what the workers and the SERVER run on) and
  `ACTOR_CATALOG`. All four come off the same trees, so nothing can drift.
- **[store.ts](store.ts)** — the active-domain accessors non-React code reads: `getActiveDomainConfig()`,
  `getActiveRegions()`, `getActiveSkyboxes()`, `getActiveActors()`, `getTerrainParams()`,
  `whenDomainReady()`.
- **[navigation/index.ts](navigation/index.ts)** — fake paths (`pushState` only), the address bar (held on the bare site until the intro lets it go: `holdAddressBar`, `flashAddressPath` for its scan), the back trap. `switchDomain` has no caller today: every path boots its domain directly.
- **[utils.ts](utils.ts)** — `resetDomainSystems()`: what a domain switch tears down between the old tree and the new.
- **overworld/**, **404/** — each world's tree, in its own folder (`OverworldDomain.tsx`, `NotFoundDomain.tsx`).

A switch happens inside ONE persistent `<CustomCanvas>`: render no domain, `resetDomainSystems()`,
mount the new tree. The canvas, GL context, compiled programs, physics world, Player and overlays
are never torn down. → [DECISIONS.md](DECISIONS.md)

## How to add a domain

1. A folder with a `<Name>Domain.tsx` exporting its tree: `export const MyDomain = (<Domain …>…</Domain>);`
2. Its id in `DOMAIN_IDS` ([net/protocol/enums.ts](../../net/protocol/enums.ts)) and its tree in `DOMAIN_TREES`.
3. Its path in [navigation/index.ts](navigation/index.ts).

Its config, its actor catalog and the server's copy follow from the tree — there is nothing else to add.
