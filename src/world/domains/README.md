# Domains

## How it works

A **domain** is one switchable world: a `<Domain>` tree of regions, biomes and global systems. There are two:

| id | path | file | what it is |
|---|---|---|---|
| `home` | `/` | [home/domain.tsx](home/domain.tsx) | the landing page: a flat black grid and the CRT address selector ([home/README.md](home/README.md)) |
| `overworld` | every other path | [overworld/domain.tsx](overworld/domain.tsx) | THE game: one infinite map of regions ([overworld/regions/README.md](overworld/regions/README.md)) |

New content almost always goes into the overworld as a **region**, not a new domain.

**One page, one canvas.** [src/index.tsx](../../index.tsx) renders ONE persistent `<CustomCanvas>` and mounts whichever domain is current. The GL context, compiled shaders, the physics world, the Player and the overlays are never torn down.

**Switching** ([navigation.ts](navigation.ts), [reset.ts](reset.ts)) runs in two phases:
1. `switchDomain(id)` / `navigateToAddress(path)` changes the current domain and fires `onDomainChange`. `index.tsx` renders NO domain, so the old one unmounts completely.
2. `resetDomainSystems()` stops the terrain/spawn/foliage/dressing workers, clears their caches and unpublishes the active domain. Then the new domain mounts, commits, and the workers boot again from its config.

**URLs are fake.** Paths are `pushState`-only, so nothing ever really navigates:
- `/` is home. Any other path parses as an overworld **address** ([overworld/README.md](overworld/README.md)). Entering an address from home is a domain switch. Entering one from inside the overworld is a teleport (`ADDRESS_TRAVEL_EVENT`).
- The browser Back button can only fire `popstate`. `navigation.ts` restores the URL and dispatches `ESCAPE_POD_EVENT`, so Back never leaves the page.
- Refreshing reloads the page and boots whatever path is in the URL.

**Publishing a domain.** When `<Domain>` commits ([../components/README.md](../components/README.md)), it publishes the result through [utils.ts](utils.ts). Non-React code reads it there: `getActiveRegions()`, `getActiveDomainConfig()`, `getTerrainParams()`, `await whenDomainReady()`.

**Server copy.** [configs.ts](configs.ts) lists every domain's region specs (`DOMAIN_REGIONS`, which the actor catalog is derived from) and maps a domain id to its Three-free `DomainConfig` (today only `overworld`, built in [overworld/config.ts](overworld/config.ts) by [domainConfig.ts](domainConfig.ts)). The server simulates on that copy. In dev, the JSX commit compares itself against it and `console.error`s the keys that differ.

Other files: [components.ts](components.ts) (`DOMAIN_COMPONENTS`: the component index.tsx mounts per id), [types.ts](types.ts) (`ActiveDomain`; `DomainId` re-exported from `src/net/protocol.ts`), [constants.ts](constants.ts) (`HOME_PATH` and the two window event names).

## How to use/add

Add a domain only for a genuinely separate page. A new area of the game is a region ([overworld/regions/README.md](overworld/regions/README.md)).

1. Create `src/world/domains/<name>/domain.tsx`:
   ```tsx
   export const NameDomain = React.memo(() => (
     <Domain background="#000000" playerSpawn={[0, 0, 0]}>
       <Terrain seed="<name>" />
       <Skybox topColor="#000" horizonColor="#000" bottomColor="#000" />
       <Regions specs={NAME_REGIONS} components={{ name: NameRegion }} />
     </Domain>
   ));
   ```
   Put its regions in `src/world/domains/<name>/regions/`, with the ordered spec list in `regions/index.ts` (`export const NAME_REGIONS = [NAME_REGION]`, see [home/regions/index.ts](home/regions/index.ts)). `terrain={false}` skips the streaming terrain. The domain then has to render its own ground and call `setTerrainLoaded(true)` / `setProgress(1)` itself, as [home/HomeGround.tsx](home/HomeGround.tsx) does.
2. Add the id to `DOMAIN_IDS` in `src/net/protocol.ts` (the one definition; `DomainId` derives from it and [types.ts](types.ts) re-exports it). The compiler then asks for the next two entries.
3. Add `<name>: NameDomain` to `DOMAIN_COMPONENTS` in [components.ts](components.ts) (index.tsx mounts it) and `<name>: NAME_REGIONS` to `DOMAIN_REGIONS` in [configs.ts](configs.ts) (so the server catalogs its actors).
4. Teach [navigation.ts](navigation.ts) its path. Today `domainIdFromPath` maps `/` to home and everything else to the overworld, so a new fixed path must be checked before the address parser.
5. Optional, for server-simulated NPCs: add `<name>/config.ts` = `buildDomainConfigFromSpecs({ params, regions: NAME_REGIONS })` (copy [overworld/config.ts](overworld/config.ts)) and list it in [configs.ts](configs.ts). The server's physics currently loads only one domain (`PHYSICS_DOMAIN` in `server/src/game/physics/physicsWorld.ts`).
