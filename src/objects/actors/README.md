# Actors

## How it works

An actor is one spawned object rendered as its own React component (a beeble, a building, a prop). [spawning/](spawning/README.md) decides where they go.

- **Spec** ([spec.ts](spec.ts) `ActorSpec`): one Three-free object per kind in `<actor>/spec.ts` — `id`, `component` (`"model"` or `"building"`, mapped in [objects/actors/registry.ts](registry.ts) `ACTOR_COMPONENTS`), member knobs (`model`, `scale`, collider options, a building's `hull`), spawn knobs (`footprint`, `density`, filters…), and what the server simulates (`stateMachine`, `body`, `collider`, `movement`, `interactReach`).
- **Mount**: `<Actor actor={SPEC} …overrides/>` inside a `<Biome>` is the only place an actor's biomes are written; `mergeActorListings` combines a kind mounted in several. Inside a FEATURE instead (`<Sewers><Rooms><Actor/></Rooms></Sewers>`) that feature places it, one per part, under its own id.
- **Catalog**: `actorCatalogOf` ([registry.ts](registry.ts)) derives `ACTOR_CATALOG` from `DOMAIN_REGIONS`, so placing a kind catalogs it for the server.
- **Descriptor**: `describeActor(spec)` ([world/components/utils.ts](../../world/components/utils.ts)) builds the client descriptor; every attribute except `SPAWN_ONLY_KEYS` ([spawning/enums.ts](spawning/enums.ts)) is forwarded to the instance as props.
- **Base**: `useActorLifecycle` ([hooks.ts](hooks.ts): one shared frame driver ([store.ts](store.ts)), distance, fade, despawn, frustum visibility, distance-gated colliders, near gate, matrix freezing) and `prepareActorMaterial` ([material.ts](material.ts): quantization, lamp glow, curvature, spawn fade). Never a `useFrame` per actor.
- **Members**: [objects/actors/model/ModelActor.tsx](model/ModelActor.tsx) — a pooled GLTF clone ([objects/actors/model/store.ts](model/store.ts)) with [colliders](model/colliders/README.md) and animation; with a `stateMachine` it also runs the [machine](state/README.md), mouse input, the kinematic body ([objects/actors/model/hooks.ts](model/hooks.ts)) and animation ([animation/](../../animation/README.md), configured by the spec's `animation`). [building/](building/README.md) owns its geometry and uses `useActorLifecycle` directly.
- **Body** (`body`): `"fixed"` (GLTF colliders), `"kinematic"` (capsule moved by the machine), `"none"`.
- **Ragdoll** ([ragdoll/](ragdoll/Ragdoll.ts)): every machine has the built-in `RAGDOLL_STATE` and `RECOVER_STATE` ([state/README.md](state/README.md)); `ModelActor` turns the first into a ragdoll and the second into the blend back up (`useActorRagdoll`, [ragdoll/hooks.ts](ragdoll/hooks.ts)). Generic over any skinned model: `skeletonLayoutOf` ([ragdoll/utils.ts](ragdoll/utils.ts)) reads which bone each vertex follows most, and every bone enough of the mesh follows (not a small leaf like a finger) becomes a dynamic box fitted to those vertices, joined to its nearest bodied ancestor by a spherical joint, in the client's Rapier world (an imperative body per part, colliding with everything but its own ragdoll's parts). Masses are clamped to one narrow range and speeds capped ([ragdoll/constants.ts](ragdoll/constants.ts)): a beeble's head outweighing its fingers 30,000× had the joints fling it off at hundreds of u/s. While limp the group is held still (`ctx.holdPose`) and the capsule is off (`setSolid`); the impulse it starts with is replicated with the entity (`RAGDOLL_IMPULSE_KEY`), so every client starts the same fall (limbs may land a little differently on two screens; the body lands in the same place). Getting up, the bones blend from where they lay into the recover clip, sliding back to the group's spot. A body cut apart ([slices/](slices/README.md)) rebuilds its bodies from the bones as they hang (`Ragdoll.rebuild`: each piece the top of its own chain, each part moving on as the part it came from), and a blast flings them (`Ragdoll.explode`). A root piece that sinks through the ground is put back on it (`Ragdoll.rescue`, objects/DECISIONS.md).
- **Live actors** ([model/registry.ts](model/registry.ts)): a mounted model actor by its spawn id (`getLiveModelActor`): its model, group, `setRagdoll` (a synced actor's limp is predicted until the server's state arrives), `ragdollPhase`, `setDrawn`. An object hung on a pooled model's bones from outside it is flagged `ATTACHMENT_FLAG` ([model/store.ts](model/store.ts)) and stripped before the clone is reused.
- **Retired** ([store.ts](store.ts) `retireActor`): an NPC that became a player (the overworld intro's host) never mounts again in the domain; the server lists them (`init.hostsTaken`, `host:taken`).
- **The MAV Unit** ([mav-unit/](mav-unit/spec.ts)): not spawned — every player's own, drawn by [player/PlayerBody.tsx](../../player/PlayerBody.tsx): alone, screwing into a host's `MAV_HOST_BONE`, or worn on the player's own head (`mavSeatOf`: the top of that bone's mesh, `poseOnSeat`; alone, `poseAlone`). The model is a placeholder built in code ([mav-unit/geometry.ts](mav-unit/geometry.ts)) until its GLB exists.

## How to add another

1. Model in `public/models/<name>.glb`, exported WITHOUT Draco compression and with SEPARATE (non-interleaved) vertex buffers (tag colliders, see [colliders/](model/colliders/README.md)). `useGLTF` is called with Draco off, so a Draco file fails to load; interleaved buffers break the clone pool's geometry merge (objects/DECISIONS.md).
2. For an NPC: `src/objects/actors/<name>/stateMachine.ts` ([state/](state/README.md)).
3. `src/objects/actors/<name>/spec.ts`:
   ```ts
   export const FROG_SPEC: ActorSpec = {
     id: "frog", model: "/models/frog.glb", footprint: …, density: …, renderDistance: …,
     // NPC only: stateMachine: FROG_SM, body: "kinematic", collider: { shape: "capsule", … }, movement: "ground",
   };
   ```
4. Mount `<Actor actor={FROG_SPEC} />` in a biome. Nothing on the server to edit — mounting it is what catalogs it.
5. Only for scene logic a machine cannot express: a component (`src/objects/actors/<name>/<Name>.tsx`) wrapping `<ModelActor onFrame={…}>` in `withModelActorWarmup`, registered in `ACTOR_COMPONENTS` ([registry.ts](registry.ts)) and `ActorComponentName`, named by `component` on the spec.

A variant spreads a base spec under a new `id` (`SKYSCRAPER_SPEC` in [building/spec.ts](building/spec.ts)).
