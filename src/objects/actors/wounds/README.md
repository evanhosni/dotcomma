# Wounds

## How it works

A WOUND is a bullet's way through a body (`Wound`, net/protocol/types.ts): an entry hole and an exit hole
(null: the bullet stayed in), each a point in the model's BIND space with the bones and weights of the
vertex nearest it, skinned each frame exactly as the surface around it is, so it stays on the skin through
every pose, ragdoll bend and corpse. (Pinned to one bone, a hole drifted off a surface that bends between
bones, and a tunnel to an exit near a shoulder stuck out of the body once the arm swung.) They are kept by the server (an NPC's entity `state.wounds`, a player's
`player:hurt`; a dead player's corpse, each client's own, gathers the holes every `shot` at it carries), up to `MAX_WOUNDS` channels a body (`MAX_HOLES` in the shader's uniform array), the oldest healing over past it.

Every pooled model clone owns a [WoundSet.ts](WoundSet.ts) (model/store.ts; cleared when the clone goes back
to the pool); whoever draws the clone sets its wounds (ModelActor from the synced state, PlayerBody from the
player's, a Corpse from the dying body's). It:
- writes each hole's centre, in the camera's VIEW space, into the clone's materials' uniforms right before
  its skinned meshes draw; [material.ts](material.ts) `patchWounds` (applied to every lit actor material by
  the actor base, `prepareActorMaterial`) discards every fragment inside a hole and stains a ring of blood
  around it (`BLOOD_RING`). View space: no absolute world coordinate is formed in float32;
- hangs its FLESH on the clone, each piece placed in the world right before it draws ([geometry.ts](geometry.ts),
  `woundTunnelMaterial`): a TUNNEL from each entry to its exit (an open, lumpy tube, lumps inward only), or a
  closed POCKET when the bullet stayed in, so a look into a hole shows the bullet's way and never the inside
  of the mesh; and a RIM on every hole, a lumpy lip of torn flesh laid along the skin's normal (carried with
  the hole), dipping over the tunnel's mouth and sinking back under the skin past the cut edge, which hides
  the seam between the two.

A limp body lies away from where it stood: the actor base culls it, and the hit test finds it, where its
ragdoll lies (`boundsCenter`, `LiveModelActor.bodyCenter`). No character capsule pushes a ragdoll's parts
(`CHARACTER_GROUP`, physics/constants.ts): one walked into a corpse flung it out of sight.

## How to add another

Nothing to add per body: any skinned actor drawn through the model pool bears wounds. A new look of the
inside is `woundTunnelMaterial`; of the stain, `BLOOD_COLOR`/`BLOOD_RING`.
