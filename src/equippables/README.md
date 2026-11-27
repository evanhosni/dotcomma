# Equippables

Anything a beeble holds in its hands: today the revolver, the AK-47, the sword and the rocket launcher. One system for every one, the player's and (later)
an NPC's.

## How it works

- **The spec** ([spec.ts](spec.ts), `EquippableSpec` in [types.ts](types.ts); Three-free, the server reads the
  id a player holds from `move.wp`): its `arms` (an array of `ARM.LEFT` / `ARM.RIGHT`, [enums.ts](enums.ts):
  the item sits in the FIRST one's hand), its `hold` (`HOLD.AIM`: the arms point where the holder looks;
  `HOLD.CARRY`: the arms are left to the animation), its `grip` (the point of the model the hand closes on),
  `scale`, a two-armed aim's `reach`, where first person draws it (`view`), and the `weapon` it fires
  (weapons/spec.ts), if any.
- **The model** ([registry.ts](registry.ts) `EQUIPPABLE_MODELS`, by id): a builder per item, one fresh model
  per hand that holds it and one for the first-person view. Its own space: forward +z, up +y, the grip where
  the spec says. Each is a PLACEHOLDER of procedural shapes (its own folder: [revolver/](revolver/index.ts),
  [ak47/](ak47/index.ts), [sword/](sword/index.ts), [rocket-launcher/](rocket-launcher/index.ts), which also
  builds the rocket in flight), merged by look and assembled with its muzzle flash by [utils.ts](utils.ts)
  over the shared looks in [material.ts](material.ts); its GLB replaces the builder, nothing else.
- **What the local player has** ([store.ts](store.ts)): what it carries (`STARTING_EQUIPPABLES`) and what is in
  its hands ("" empty-handed). **Hold Tab** for the wheel ([menus/overlay/EquipWheelOverlay.tsx](../menus/overlay/EquipWheelOverlay.tsx)):
  the mouse steers to a slice instead of turning the view; letting go of Tab takes it in hand. Only a beeble
  at play picks (not a MAV Unit, not while the intro or a death holds the player).
- **The holding** ([EquippableHolder.ts](EquippableHolder.ts), one per body: player/PlayerBody.tsx), every
  frame AFTER the animation posed the bones: an AIM points each of the spec's arms (upper and lower bones,
  `ARM_BONES` in [constants.ts](constants.ts): Blender bones run along their +y) at the look (one arm parallel
  to it, two meeting `reach` before the chest), blended in and out over `HOLD_BLEND_SECONDS`; the model lies
  in the first arm's hand (where its finger bones start), forward along the forearm, up as near the world's up
  as it can be. The look is the body's drawn head (player/utils.ts `lookOfBody`: what every client has of a
  player), so everyone sees the same aim. The models hang under a group of their own, never on the pooled
  clone's bones.

## How to add one

1. An `EquippableSpec` in [spec.ts](spec.ts) and its `EQUIPPABLES` entry (to start with it,
   `STARTING_EQUIPPABLES`). A weapon: its `WeaponSpec` first (weapons/README.md), with the same id.
2. Its model builder in [registry.ts](registry.ts) (its own folder for its art, like [revolver/](revolver/index.ts)).
   [tests/equippables.test.ts](tests/equippables.test.ts) fails for an equippable with no model, no arms, or
   an unknown weapon.
