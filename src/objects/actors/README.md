# Actors

## How it works

An actor is one spawned object rendered as its own React component (a beeble, a building, a prop). [spawning/](spawning/README.md) decides where they go.

- **Spec** ([spec.ts](spec.ts) `ActorSpec`): one Three-free object per kind in `<actor>/spec.ts` — `id`, `component` (`"model"` or `"building"`, mapped in [components.ts](components.ts) `ACTOR_COMPONENTS`), member knobs (`model`, `scale`, collider options, a building's `hull`), spawn knobs (`footprint`, `density`, filters…), and what the server simulates (`stateMachine`, `body`, `collider`, `movement`, `interactReach`).
- **Mount**: a biome spec's `actors` list (`ActorMount` = spec + overrides) is the only place an actor's biomes are written; `mergeActorListings` combines a kind listed in several biomes.
- **Catalog**: `actorCatalogOf` ([catalog.ts](catalog.ts)) derives `ACTOR_CATALOG` from `DOMAIN_REGIONS`, so placing a kind catalogs it for the server.
- **Descriptor**: `describeActor(spec)` ([../../world/components/Actor.tsx](../../world/components/Actor.tsx)) builds the client descriptor; every attribute except `SPAWN_ONLY_KEYS` ([spawning/types.ts](spawning/types.ts)) is forwarded to the instance as props.
- **Base** ([Actor.tsx](Actor.tsx)): `useActorLifecycle` (one shared frame driver, distance, fade, despawn, frustum visibility, distance-gated colliders, near gate, matrix freezing) and `prepareActorMaterial` (quantization, lamp glow, curvature, spawn fade). Never a `useFrame` per actor.
- **Members**: [ModelActor.tsx](ModelActor.tsx) — a pooled GLTF clone ([modelClonePool.ts](modelClonePool.ts)) with [colliders](colliders/README.md) and animation; with a `stateMachine` it also runs the [machine](state/README.md), mouse input, the kinematic body ([kinematicMover.tsx](kinematicMover.tsx)) and animation ([animationPlayer.ts](animationPlayer.ts)). [building/](building/README.md) owns its geometry and uses `useActorLifecycle` directly.
- **Body** (`body`): `"fixed"` (GLTF colliders), `"kinematic"` (capsule moved by the machine), `"none"`.

## How to add another

1. Model in `public/models/<name>.glb` (tag colliders, see [colliders/](colliders/README.md)).
2. For an NPC: `src/objects/actors/<name>/stateMachine.ts` ([state/](state/README.md)).
3. `src/objects/actors/<name>/spec.ts`:
   ```ts
   export const FROG_SPEC: ActorSpec = {
     id: "frog", model: "/models/frog.glb", footprint: …, density: …, renderDistance: …,
     // NPC only: stateMachine: FROG_SM, body: "kinematic", collider: { shape: "capsule", … }, movement: "ground",
   };
   ```
4. List `{ actor: FROG_SPEC }` in a biome spec's `actors`. Nothing on the server to edit.
5. Only for scene logic a machine cannot express: a component wrapping `<ModelActor onFrame={…}>` in `withModelActorWarmup`, registered in `ACTOR_COMPONENTS` and `ActorComponentName`, named by `component` on the spec.

A variant spreads a base spec under a new `id` (`SKYSCRAPER_SPEC` in [building/spec.ts](building/spec.ts)).
