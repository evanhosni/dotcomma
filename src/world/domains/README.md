# Domains

## How it works

A DOMAIN is one switchable world. There are two: `overworld` (THE game, one infinite map — every
URL path but `/` is an address inside it) and `home` (the landing page at `/`).

- **[index.ts](index.ts)** — `DOMAIN_TREES` (each world as the one JSX element it is), `DOMAIN_NODES`
  (each tree read as data), `DOMAIN_CONFIGS` (what the workers and the SERVER run on) and
  `ACTOR_CATALOG`. All four come off the same trees, so nothing can drift.
- **[utils.ts](utils.ts)** — the active-domain accessors non-React code reads: `getActiveDomainConfig()`,
  `getActiveRegions()`, `getActiveSkyboxes()`, `getActiveActors()`, `getTerrainParams()`,
  `whenDomainReady()`.
- **[navigation.ts](navigation.ts)** — fake paths (`pushState` only), travel events, the back trap.
- **[reset.ts](reset.ts)** — what a domain switch tears down between the old tree and the new.
- **overworld/**, **home/** — each world's tree, in its own folder.

A switch happens inside ONE persistent `<CustomCanvas>`: render no domain, `resetDomainSystems()`,
mount the new tree. The canvas, GL context, compiled programs, physics world, Player and overlays
are never torn down. → [DECISIONS.md](DECISIONS.md)

## How to add a domain

1. A folder with an `index.tsx` exporting its tree: `export const MyDomain = (<Domain …>…</Domain>);`
2. Its id in `DOMAIN_IDS` ([net/protocol.ts](../../net/protocol.ts)) and its tree in `DOMAIN_TREES`.
3. Its path in [navigation.ts](navigation.ts).

Its config, its actor catalog and the server's copy follow from the tree — there is nothing else to add.
