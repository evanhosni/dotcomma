# The content tree

## How it works

A world is ONE JSX tree. React renders it for the player; a Three-free walker reads the SAME
elements as data for the workers and the server. There is no spec list beside the JSX and no
registry anywhere: **a thing exists because a component is mounted, a knob is a prop, a part is a
child.** To remove the sewers, delete `<Sewers>` from the biome.

- **[types.ts](types.ts)** — `ContentDeclaration` (what one declaration contributes) and
  `ContentNode` (one mounted declaration, as the walker reads it).
- **[index.ts](index.ts)** — `declare()`, `content()` and the walker.
- **[config.ts](config.ts)** — THE `DomainConfig` assembler, plus `actorPlacementsOf`,
  `biomeNoiseOf`, `terrainParamsOf`, `biomeIdOf`. Three-free and React-free: `server/` imports it.

### A declaration

```ts
export const Snow = declare<SnowProps>({
  kind: SNOW,            // its tag in the walked tree, and its key in a biome's `features`
  within: "biome",       // where it may be mounted; a dev throw otherwise
  read: (node) => ({ ...SNOW_DEFAULTS, ...node.props }),   // its RESOLVED params for the config
  Driver: () => <SnowDriver />,                            // the ONE system mounted for it
  // View: what React renders in its place, when it draws itself rather than through a driver
});
```

`within` may be a kind, a list of kinds, `null` (top level only) or omitted (anywhere — `<Actor>`
stands in a biome or inside one of its features, and its path says which).

### A content file

A content file exports a static ELEMENT, wrapped so it still reads as a component:

```tsx
export const CityBiome = content(
  <Biome id={1} name="city" joinable blendWidth={2}>…</Biome>,
);
```

**Never a function that builds one.** The walker never CALLS a component — it reads `props.children`
down the element objects — which is what lets a view with hooks sit in the tree, and what lets the
server read a tree whose views import three.js. A function component's children would be out of
reach.

### Who reads it

| reader | how |
|---|---|
| React | renders the tree; each declaration draws its `View`, or nothing |
| `<Domain>` | walks its children once, publishes the config + look model + skies + actors, then mounts every `Driver` the tree asked for |
| the workers | the published `DomainConfig` over postMessage |
| the server | imports `world/domains` → `DOMAIN_NODES` / `DOMAIN_CONFIGS` / `ACTOR_CATALOG`, with three.js stubbed by its build |

### Hazards

- **Config literals.** Every prop `config.ts` reads must be a literal or a Three-free constant. The
  server's build replaces three.js with a stub that answers anything, so a prop computed from a
  three.js value would become a proxy in the server's config — silently.
- **JSX order is VORONOI order** for `<Region>` and `<Biome>` children. Reordering or appending one
  re-rolls every cell of that grid and moves every address.
- **One driver per kind.** A dressing or particle feature mounted in several biomes is still drawn
  by ONE driver, because chunks are world-space. Read the mounts with `featureMounts(kind)` and take
  the `farthest` view distance among them.

## How to add a declaration

1. Put it in the folder of the system it belongs to, as that folder's `index.ts(x)`.
2. `declare({ kind, within, read?, View?, Driver? })`. Give `kind` a constant in a Three-free
   module (`params.ts`) so the pipeline and the component share one string.
3. If the pipeline reads it, export its accessors beside it:
   `export const snowBiomeIds = () => biomeIdsWith(SNOW)`.
4. Mount it. Nothing else — no registry entry, no config field, no flag.
