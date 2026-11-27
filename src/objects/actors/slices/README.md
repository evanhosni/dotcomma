# Slices

## How it works

A SLICE is a cut through a body (`Cut`, net/protocol/types.ts): a plane per bone it crossed, each in the
model's BIND space as that bone carried it when the blade passed, so every client cuts the same body the same
way whatever pose its own copy lies in. A sword swing makes one (weapons/utils.ts `sliceHitsOf`); a rocket's
blast is a BURST: `GIB_PLANES` planes through the body that cut every bone (`b` "*"), placed by the body's id
([utils.ts](utils.ts) `gibCutsOf`), so only the blast's centre goes on the wire. The server keeps a dead NPC's
cuts (the first `MAX_CUTS`, in order) and its burst in its state; a player's killing blow rides `player:died`
to its corpse; later cuts at a corpse ride each `shot`.

Every pooled model clone owns a [SliceSet.ts](SliceSet.ts) (model/store.ts), set by whoever draws the clone
(ModelActor from the synced state plus its own blow until the state says the same, a Corpse from its death
and every strike since), only while the body lies limp. Each cut:
- splits every triangle it crosses ([geometry.ts](geometry.ts) `sliceMesh`): each vertex measured against
  the plane of its heaviest named bone, a vertex next to one borrowing its plane, each side getting its own
  copies of the new vertices with every attribute and skin weight blended, and the cut edge of each side
  capped with flesh (a fan from its loop's middle, group 1 of the geometry, [material.ts](material.ts));
- finds the PIECES: what the cut crossed, connected through each vertex's WELD (one id per point of the
  surface, so seam copies hold together and two parted pieces never rejoin, however close);
- splits the SKELETON: a bone belongs to the piece weighing most on it; another piece leaning on it gets a
  copy (`<bone>~<cut>.<n>`, deterministic), and a bone whose parent another piece owns is re-rooted under
  the armature, so no joint holds the pieces together. An island the cut never crossed (an eye) rides its
  bones as before;
- and the ragdoll REBUILDS its bodies from the bones as they hang (`Ragdoll.rebuild`, each part keeping the
  motion of the part it came from); a fresh burst then flings every part from the blast (`Ragdoll.explode`).
  A fresh cut's stumps spurt blood for `BLEED_SECONDS` (vfx/blood/ `addBleeder`).

`dispose` puts the clone's own geometry, materials, skeleton and bone hierarchy back. It runs BEFORE the
ragdoll lets go, which then restores the standing pose onto the bones the slices put back.

**The flesh's programs are warmed from each model's real meshes** at load (`fleshTemplatesOf`, ModelActor's
warm-up): they key on the mesh's skinning and morph targets. One linked mid-play made the cut's frame 200ms,
the variable physics step that long, and the pieces fell through the street (objects/DECISIONS.md).

## How to add another

Nothing per body: any skinned actor drawn through the model pool can be cut. A new look of the inside is
`fleshMaterial`; how hard a burst flings is `GIB_SPEED` / `GIB_SPIN`, how many chunks `GIB_PLANES`.
