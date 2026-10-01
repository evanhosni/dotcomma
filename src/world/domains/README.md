# Domains

## How it works

- A **domain** is one switchable world: `home` (path `/`, [home/domain.tsx](home/domain.tsx)) and `overworld` (every other path, [overworld/domain.tsx](overworld/domain.tsx)).
- [src/index.tsx](../../index.tsx) renders ONE persistent `<CustomCanvas>` and mounts the current domain from `DOMAIN_COMPONENTS` ([components.ts](components.ts)). GL context, physics world and Player are never torn down.
- **Switching** ([navigation.ts](navigation.ts), [reset.ts](reset.ts)): `switchDomain` / `navigateToAddress` → no domain is rendered (old one unmounts) → `resetDomainSystems()` stops the workers, clears caches and unpublishes → the new domain mounts and commits.
- **URLs are fake** (`pushState` only). `domainIdFromPath` maps `/` to home, anything else to an overworld address. Inside the overworld an address is a teleport (`ADDRESS_TRAVEL_EVENT`). Back fires `ESCAPE_POD_EVENT` and never leaves the page.
- **Publishing:** the commit publishes through [utils.ts](utils.ts): `getActiveRegions()`, `getActiveDomainConfig()`, `getTerrainParams()`, `whenDomainReady()`.
- **Server copy:** [configs.ts](configs.ts) holds `DOMAIN_REGIONS` and each simulated domain's Three-free config (built by `buildDomainConfigFromSpecs` in [domainConfig.ts](domainConfig.ts)).
- [types.ts](types.ts): `ActiveDomain`, `DomainId`; [constants.ts](constants.ts): `HOME_PATH` and the event names.

## How to add another

Only for a genuinely separate page; new game areas are regions ([overworld/regions/README.md](overworld/regions/README.md)).

1. Create `<name>/domain.tsx`: a `<Domain>` with `<Terrain>`, `<Skybox>` and `<Regions specs={NAME_REGIONS} components={…}>`; put regions in `<name>/regions/` with the ordered list in `regions/index.ts`. With `terrain={false}`, render your own ground and set `terrainLoaded`/`progress` (see [home/HomeGround.tsx](home/HomeGround.tsx)).
2. Add the id to `DOMAIN_IDS` in `src/net/protocol.ts`.
3. Add it to `DOMAIN_COMPONENTS` ([components.ts](components.ts)) and `DOMAIN_REGIONS` ([configs.ts](configs.ts)).
4. Teach `domainIdFromPath` ([navigation.ts](navigation.ts)) its path.
5. Optional (server NPCs): add `<name>/config.ts` via `buildDomainConfigFromSpecs` and list it in [configs.ts](configs.ts) (the server's physics loads `PHYSICS_DOMAIN` only).
