# Sky

## How it works

- **Skybox** ([Skybox.tsx](Skybox.tsx)): one camera-following gradient sphere (top / horizon / bottom). `<Skybox>` only registers colors, scoped by where it is mounted: domain (default, and the only `radius` read), region, or biome.
- `SkyboxSystem` (mounted by `<Domain>`) polls the player's place (`getPlaceInfo`, off-thread) only when scoped skies exist: a biome sky wins; otherwise region skies are MIXED by region weights, so the sky fades across region edges. Colors ease toward the target (`COLOR_LERP_RATE`), then toward `NIGHT_SKY_COLORS` by the night blend.
- **Day/night** ([DayNightCycle.tsx](DayNightCycle.tsx), mounted by the overworld): computes the night blend from the server clock (`nightBlendAt(getServerTime(), …)`), publishes it with `setNightBlend`, draws the sun, moon and stars ([celestialBodies.ts](celestialBodies.ts)), and pre-compiles the scene at mount so nightfall doesn't hitch.

## How to add another

1. Mount `<Skybox topColor horizonColor bottomColor />` inside a `<Region>` or `<Biome>` (import from `world/components`). Prefer region skies; biome skies switch without position mixing.

Tune: `DAY_DURATION_MS`, `NIGHT_DURATION_MS`, `DAY_NIGHT_CYCLE_TRANSITION_MS`, `NIGHT_SKY_COLORS`, `SUN_DIRECTION`, `MOON_DIRECTION` in `lighting/dayNight.ts`; celestial look in [celestialBodies.ts](celestialBodies.ts).
