# Weapons

## How it works

A weapon is held as an EQUIPPABLE ([equippables/](../equippables/README.md): the wheel, the hands, the model)
that names a `WeaponSpec` ([spec.ts](spec.ts): how it strikes, damage, rate, range, hole size, blast radius,
blood; Three-free, the server checks every shot against it). Four exist: the revolver and the AK-47 (BULLETS;
the AK fires while the button is held, smaller holes, three hits kill), the sword (a BLADE: one swing kills
and cuts) and the rocket launcher (a BLAST: bursts every body near where it goes off).

[WeaponDriver.tsx](WeaponDriver.tsx) (mounted once, inside the physics world):
- puts what is in hand in the body's state (`PlayerBodyState.equipped`, sent as `move.wp`): held in the body's
  hands in third person and to everyone else (player/PlayerBody.tsx → `EquippableHolder`), and drawn before
  the eye in first person (the viewmodel, at the equippable's `view` offset, with recoil; a swing sweeps the
  blade across its plane);
- uses a weapon on the left button while the pointer is locked, no faster than `fireInterval` (an
  `automatic` keeps firing while it is held). How it strikes:
  - a BULLET is the crosshair's ray (`aimFromCamera`). It GOES THROUGH every body on its way and stops at the
    world's first FIXED collider (a building, the ground), within `range`; there it leaves a bullet hole
    ([vfx/decals/](../vfx/decals/README.md), `BULLET_HOLE_SIZE`). The bodies are found HERE ([utils.ts](utils.ts)
    `shotHitsOf`: triangle by triangle on the posed skinned meshes of the server-known NPCs, the other
    players' beebles and the dead players' corpses), because only the client has the drawn pose: nearest
    first, `MAX_SHOT_HITS` at most, and in each body the surfaces crossed within `MAX_BODY_DEPTH` paired into
    WOUNDS (entry → exit, each hole skinned by its nearest vertex's bones and weights);
  - a BLADE's swing is a plane through the look, tilted anew each swing (`SWING_TILT`, alternating sides):
    every body whose posed triangles it crosses in front of the eye, within `range` and the swing's arc, is
    CUT along it (`sliceHitsOf`: a plane per bone it crossed, carried into the bind space;
    [objects/actors/slices/](../objects/actors/slices/README.md));
  - a BLAST is a rocket ([rockets/Rockets.ts](rockets/Rockets.ts)) flying at `ROCKET_SPEED` until it meets
    the world, comes near a body or has flown its range; there it explodes ([vfx/explosions/](../vfx/explosions/Explosions.tsx):
    fireball, smoke, sparks, a scorch decal), and every body within `blastRadius` BURSTS into chunks
    (`blastHitsOf`). Its `shoot` goes when it explodes, from where the shooter stands then;
- sends `shoot` (every hit, and where it stopped); the SERVER validates each hit by the weapon's kind (only a
  blade's hit cuts, only a blast's bursts, a blast's bodies lie near its centre; server/DECISIONS.md) and
  applies it: an NPC's or a player's holes, cuts and burst come back with its state. Drawn here at once, for
  each body: blood ([vfx/blood/](../vfx/blood/BloodSprays.tsx): the weapon's `blood` bursts, each a couple of
  hundred drops lying where they land as blood decals; a cut's stumps keep spurting), a corpse's shove along
  the blow, and an NPC's cut or burst, its death predicted, until its state says the same;
- draws other players' `shot`s the same way (the hits the server accepted, a blast's explosion), and their
  weapon's muzzle flash (`PlayerBodyState.shots`; [index.ts](index.ts) `flashMuzzle`).

While a weapon is in hand the mouse fires it: nothing under the crosshair takes a click (`setHoverSuspended`,
utils/cursor/).

**Damage and death.** A weapon takes `damage` health per hit (the revolver, the sword and a blast: all of
it). An NPC with `health` on its spec dies at 0: limp for good (the server's RAGDOLL state, never left), thrown
along the blow (`KILL_PUSH` to the part it hit, `KILL_CARRY` of it to the whole body), lying `CORPSE_SECONDS`
and still taking holes, cuts and shoves, then retired. A player's host (`PLAYER_HEALTH`) dies the same way:
`player:died` (with its corpse's id, and the killing blow's cuts or burst) → a corpse
([player/corpses/](../player/corpses/Corpses.tsx)) that every client's shots still hole, cut and shove, and,
for the local player, the intro's RESCAN (world/domains/overworld/intro/README.md). Holes:
[objects/actors/wounds/](../objects/actors/wounds/README.md); cuts and bursts:
[objects/actors/slices/](../objects/actors/slices/README.md).

## How to add another

1. A `WeaponSpec` in [spec.ts](spec.ts) and its `WEAPONS` entry (its `attack`, damage, rate, range, hole size,
   blood; a blast's `blastRadius`).
2. An equippable that fires it (equippables/README.md: its spec with `weapon`, its model with a
   `MUZZLE_FLASH_NAME` sprite at the muzzle when it has one).
