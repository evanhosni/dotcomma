# Intro

## How it works

THE way into the overworld: every boot of `/` or of an address plays it. The player starts as a MAV Unit
(manual anti virus, [objects/actors/mav-unit/](../../../../objects/actors/mav-unit/spec.ts)): the device that
connects a player in the real world to dotcomma. It needs an organic host, so it falls from the sky into a
beeble NPC's skull, and the player wakes up as that beeble. [Intro.tsx](Intro.tsx) runs it, one phase after
another ([types.ts](types.ts) `IntroPhase`), owning the camera and the player's body state while it does
(`setPlayerHeld`, [player/store.ts](../../../../player/store.ts)):

1. **title**: the unit hovers `DROP_HEIGHT` over the start (the address's site, or the origin's cell),
   looking straight down at "dotcomma" and "- click to enter -" written in the sky below it
   ([SkyTitle.ts](SkyTitle.ts), each line a [SkyLabel.ts](SkyLabel.ts)), over a black drawn IN the scene (a page black would hide the text too).
   The address bar is held on the boot path (`holdAddressBar`): the bare site shows no path. The title is
   on screen the moment the page loads: public/index.html carries an exact copy of it (black around it, the
   same type sizes and places as the camera sees the sky's: [IntroOverlay.ts](IntroOverlay.ts) `layoutTitle`,
   from the constants), over the canvas until the fall starts, when the sky's own title (drawn behind it all
   along) takes over. The copy takes the click and locks the pointer; a click while the game is still loading
   shows "- loading -" and enters as soon as it is up (without the lock: the next click on the world takes it). No crosshair
   (`setCursorLook`, utils/cursor/).
2. **scanning**: "- scanning for host -". Every message stays up at least `PROMPT_MIN_SECONDS`, and a new one keeps the type size and widens the label ([SkyLabel.ts](SkyLabel.ts)). The address bar flicks through places (`flashAddressPath`) while
   [utils.ts](utils.ts) searches for a host: the start, then rings of places around it (`searchPlaces`), each
   searched for beebles standing on the surface (`hostsAround`: the same deterministic spawn points
   ActorPool mounts, through `loadSpawnPointsAround`, always asked with the pool's WHOLE descriptor set: asked
   for the beeble alone, the per-chunk cache marked the host's chunks done without their buildings, which then
   never mounted, only their far sprites drew), the nearest claimed from the server (`claimHost`: a claim the server does not answer counts as
   granted only with no connection; with one it is a refusal, so two players never both take one beeble). At
   least `SCAN_MIN_SECONDS`: it hides the first terrain load. An OPENED ADDRESS is where the player asked to
   go: the bar never flicks, its own cell is searched first (`ADDRESS_SEARCH_RADIUS`, beebles standing in that
   cell only), and only when it has no free beeble does the prompt say so (`PROMPT_EXPANDING`) and the scan
   widen, flicking, to the places around it.
3. **found**: "- host found -"; in the black the unit moves over its host and the terrain gate restarts there
   (`loadAround`). The address bar is let go and shows the host's place. No host anywhere: "- no host found -",
   and the player lands as a beeble already wearing its unit.
4. **falling**: "host found" first waits (up to `HOST_MOUNT_WAIT_SECONDS`) for the host to be mounted here,
   so the fall tracks where it really is from the first frame. The unit falls straight down through the title
   (which travels with it), the black fading out and its scan (`SCAN.strength`,
   [vfx/screen-pass/ScanPass.ts](../../../../vfx/screen-pass/ScanPass.ts)) fading in, the MAV reticle showing
   once below the title. It is LOCKED over its host the whole way (`trackHost`: over its feet, onto the top of
   its head, its SEAT, `mavSeatOf`, over the last `SEAT_BLEND_HEIGHT`); an eased homing lagged behind a walking
   host and caught up in jumps. A change of target (a refused host) is glided over. It accelerates out of the
   hover and DIVES into the impact (`fallSpeedAt`: up to `DIVE_BOOST` faster over the last `DIVE_HEIGHT`).
   Only when it cannot land yet (the ground, the host, the host's SKY TEST: a ray from its head straight up to
   the unit meets no fixed collider, a bridge, an overhang, a building, tested as soon as the host is mounted,
   at any height) does it brake to `HOLD_HEIGHT` and wait; a host that fails is released and never offered
   again, another is claimed from where it stood, and one held over too long (`HOLD_GIVE_UP_SECONDS`) is
   refused too. NPCs never notice a lone unit (`PLAYER_DETECTABILITY`, player/spec.ts): the host keeps walking.
5. **installing**: the impact ragdolls the host (`host` step `impact`: the server's built-in RAGDOLL state,
   predicted here at once; a step with no claim on record claims the host then, so a server restart between
   claim and impact cannot leave it standing) and the unit screws in (`mavDepth`), the camera risen
   `INSTALL_CAMERA_HEIGHT` above it. Then black, the reticle gone; the crosshair dot returns at the hand-off.
6. **waking**: the scan is gone; the camera is the host's eyes lying on its side (`lyingViewOf`: rolled onto
   the side its head lies on, never under the ground), the host's model hidden here; the eyelids blink open
   (`BLINKS`).
7. **standing**: `wake` stands the host up on every client (the ragdoll blending into its recover clip,
   held there by the server); the camera rises and levels into exactly the Player's first view (its eyes over the host's feet, facing the host's REAL yaw: the drawn one is stepped to each camera) and hands off only once fully risen, then
   `possess` retires the NPC for everyone (`host:taken`) and the player stands where it stood
   (`placePlayer`), a beeble wearing its unit. Other players swap the NPC for the player's beeble in one frame: RemotePlayers retires it as that player is first SHOWN in its beeble form (its move is played back late), not when `host:taken` arrives.

What other players see comes through the player's own `move`s (`fm`, `mh`, `md`,
[net/protocol/types.ts](../../../../net/protocol/types.ts)): the unit falling, the unit screwing into the
NPC's head (where that NPC is mounted for them), then the beeble wearing it ([player/PlayerBody.tsx](../../../../player/PlayerBody.tsx)).
The title, the black and the blinking are this player's alone.

## How to add another

N/A — one way in. Planned (Nov 2026): a player's death kills its host for good and replays the intro from
the scan; a shared link will skip it (a beeble already wearing its unit, falling from the sky). Timings and
distances are in [constants.ts](constants.ts).
