# Decals

Marks lying ON the world's surfaces: blood where a drop landed, bullet holes where a shot stopped. One system
for every kind.

## How it works

- **Stamp one** ([index.ts](index.ts) `stampDecal(kind, at, normal, size)`): a point on a surface, its normal
  (the decal lies across it, turned a random way about it) and a width. The callers find the surface with a
  Rapier ray against the FIXED colliders (ground, buildings): vfx/blood/BloodSprays.tsx per drop, each frame's
  step; weapons/WeaponDriver.tsx per shot.
- **The kinds** ([registry.ts](registry.ts) `DECAL_LOOKS`, [enums.ts](enums.ts) `DECAL_KINDS`): each its
  SHAPE (GLSL in [material.ts](material.ts): cut out of a quad by the decal's own seed, so no two are alike
  and no texture is needed), how long it lies (`seconds`, shrinking away over its last
  `DECAL_SHRINK_SECONDS`) and how many are drawn at once (`capacity`).
- **The drawing** ([Decals.tsx](Decals.tsx), mounted once with the canvas; [DecalLayer.ts](DecalLayer.ts) per
  kind): instanced quads in BATCHES of `BATCH_SIZE`, each placed at its first decal and taking only decals
  within `BATCH_REACH` of it (float32 offsets stay metres: COORDINATE_PRECISION.md); a batch whose newest decal
  is past its time is free again, and past the kind's capacity the batch stamped longest ago starts over. The
  material is the actor base's (prepareActorMaterial: curvature, spawn fade; no quantization, no lamp glow),
  drawn after the opaque world without writing depth, pulled forward by a polygon offset and lifted
  `DECAL_LIFT` off the surface.

## How to add a kind

1. Its name in [enums.ts](enums.ts) `DECAL_KINDS`.
2. Its look in [registry.ts](registry.ts): a shape (GLSL setting `decalColor` from `p` and `seed`, or
   discarding; helpers `decalHash`, `decalWave`), its seconds and capacity.
3. `stampDecal("<kind>", …)` where it happens.
