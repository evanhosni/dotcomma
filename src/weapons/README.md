# Weapons

## How it works

A weapon is held as an EQUIPPABLE ([equippables/](../equippables/README.md): the wheel, the hands, the model)
that names a `WeaponSpec` ([spec.ts](spec.ts): damage, rate, range, hole size; Three-free, the server checks
every shot against it). The revolver is the only one.

[WeaponDriver.tsx](WeaponDriver.tsx) (mounted once, inside the physics world):
- puts what is in hand in the body's state (`PlayerBodyState.equipped`, sent as `move.wp`): held in the body's
  hands in third person and to everyone else (player/PlayerBody.tsx → `EquippableHolder`), and drawn before
  the eye in first person (the viewmodel, with recoil);
- fires a weapon on the left button while the pointer is locked, no faster than `fireInterval`. A shot is the
  crosshair's ray (`aimFromCamera`). It GOES THROUGH every body on its way and stops at the world's first
  FIXED collider (a building, the ground), within `range`; there it leaves a bullet hole
  ([vfx/decals/](../vfx/decals/README.md), `BULLET_HOLE_SIZE`, across the surface's normal). The bodies are
  found HERE ([utils.ts](utils.ts) `shotHitsOf`: triangle by triangle on the posed skinned meshes of the
  server-known NPCs, the other players' beebles and the dead players' corpses), because only the client has
  the drawn pose: nearest first, `MAX_SHOT_HITS` at most, and in each body the surfaces crossed within
  `MAX_BODY_DEPTH` paired into WOUNDS (entry → exit, each hole skinned by its nearest vertex's bones and
  weights), `MAX_WOUNDS_PER_SHOT` at most;
- sends `shoot` (every hit, and where it stopped); the SERVER validates each hit and applies it
  (server/DECISIONS.md); an NPC's or a player's holes come back with its state. Drawn here at once, for each
  body: blood ([vfx/blood/](../vfx/blood/BloodSprays.tsx): two bursts, at the wound and out of the body's far
  side, each a couple of hundred drops flung along the bullet and back toward the shooter, each lying where
  it lands as a blood decal), a corpse's shove along the bullet (`CORPSE_PUSH`, each client's own ragdoll),
  and a player's corpse's new holes;
- draws other players' `shot`s the same way (the hits the server accepted), and their gun's muzzle flash
  (`PlayerBodyState.shots`; [index.ts](index.ts) `flashMuzzle`: the model's `MUZZLE_FLASH_NAME` sprite).

While a weapon is in hand the mouse fires it: nothing under the crosshair takes a click (`setHoverSuspended`,
utils/cursor/).

**Damage and death.** A weapon takes `damage` health per hit (the revolver: all of it, one hit kills). An
NPC with `health` on its spec dies at 0: limp for good (the server's RAGDOLL state, never left), thrown along
the bullet (`KILL_PUSH` to the part it hit, `KILL_CARRY` of it to the whole body), lying `CORPSE_SECONDS` and
still taking holes and shoves, then retired. A player's host (`PLAYER_HEALTH`) dies the same way:
`player:died` (with its corpse's id) → a corpse ([player/corpses/](../player/corpses/Corpses.tsx)) that every
client's shots still hole and shove, and, for the local player, the intro's RESCAN
(world/domains/overworld/intro/README.md). Holes: [objects/actors/wounds/](../objects/actors/wounds/README.md).

## How to add another

1. A `WeaponSpec` in [spec.ts](spec.ts) and its `WEAPONS` entry (damage, rate, range, hole size).
2. An equippable that fires it (equippables/README.md: its spec with `weapon`, its model with a
   `MUZZLE_FLASH_NAME` sprite at the muzzle).
