# Sky

## How it works

Two independent pieces live here:

**The skybox** ([Skybox.tsx](Skybox.tsx)) is one gradient sphere (top / horizon / bottom color) that follows the camera.

- `<Skybox>` is a **registration** component. It renders nothing. It stores its colors in the domain store under a scope that depends on where it is mounted:
  - under `<Domain>`: the **default** sky (also the only place `radius` is read);
  - under `<Region>`: that region's sky;
  - under `<Biome>`: that biome's sky.
- `SkyboxSystem` (mounted by `<Domain>`, in [world/components/Domain.tsx](../components/Domain.tsx)) picks the target colors every 0.5s from the player's place (`getPlaceInfo`, answered off-thread by the dressing worker):
  1. if the player's biome has a sky, use it;
  2. otherwise **mix the region skies** by the player's region weights, so crossing a region edge fades the sky gradually. A region without its own sky uses the domain default.
- The shown colors ease toward the target (`COLOR_LERP_RATE`), then lerp toward `NIGHT_SKY_COLORS` ([lighting/dayNight.ts](../../lighting/dayNight.ts)) by the night blend.
- The place is only polled when at least one region or biome sky exists.

**The day/night cycle** ([DayNightCycle.tsx](DayNightCycle.tsx)) is mounted by the overworld domain. It:

- computes the night blend from the **server clock** (`nightBlendAt(getServerTime(), …)` in [lighting/dayNight.ts](../../lighting/dayNight.ts)), so every player sees the same time of day, and writes it with `setNightBlend` (read by everything through [lighting/](../../lighting/));
- draws the jittery low-poly sun disc, crescent moon and stars, which follow the camera. They shrink/grow with the blend;
- pre-compiles the scene's shaders at mount and warm-draws the moon and stars for two frames. Without this, the first nightfall hitches. The reason is in [CLAUDE.md](../../../CLAUDE.md) under `sky/DayNightCycle.tsx`.

## How to use/add

### Add a sky to a region or biome

1. Open the region's `region.tsx` (e.g. [desert/region.tsx](../domains/overworld/regions/desert/region.tsx)) or the biome's `biome.tsx`.
2. Import `Skybox` from the components barrel (`world/components`, the same import that gives you `Region`/`Biome`).
3. Mount it inside the `<Region>` or `<Biome>`:

   ```tsx
   <Region spec={NAME_REGION} biomes={{ name: NameBiome }}>
     <Material shader={baseShader} textures={{ nametexture: "name.jpg" }} />
     <Skybox topColor="#c98a4b" horizonColor="#f0c890" bottomColor="#6b5a4a" />
   </Region>
   ```

That is all. You don't need to register anything else.

Notes:
- A **biome** sky switches when the player's own biome changes. The eased colors smooth that over a second or two, but a biome sky is not position-mixed like region skies. Prefer region skies for large-scale mood.
- Colors are any CSS color string three.js accepts.
- To change the default sky, edit the `<Skybox>` in the domain file ([overworld/domain.tsx](../domains/overworld/domain.tsx)).

### Tune the cycle

- Day, night and transition lengths: `DAY_DURATION_MS`, `NIGHT_DURATION_MS`, `DAY_NIGHT_CYCLE_TRANSITION_MS` in [lighting/dayNight.ts](../../lighting/dayNight.ts). They can also be overridden per domain as `<DayNightCycle>` props.
- Night sky colors: `NIGHT_SKY_COLORS` in the same file.
- Sun/moon look (size, roundness, jitter): the constants at the top of [DayNightCycle.tsx](DayNightCycle.tsx).
- Sun/moon direction: `SUN_DIRECTION` / `MOON_DIRECTION` in `dayNight.ts`. These also aim the directional light.
