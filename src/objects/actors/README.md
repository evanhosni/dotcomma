# Actors

## How it works

An **actor** is one spawned object that is its own React component: a beeble, a building, a clickable prop. The spawn system decides where actors go ([spawning/README.md](spawning/README.md)), and each point it places mounts one component.

**Spec.** An actor kind is ONE Three-free object, its `<actor>/spec.ts` (`ActorSpec`, [spec.ts](spec.ts)):
- identity: `id` (unique; also the entity kind on the wire) and `component` — the client member that renders it, `"model"` (default, [ModelActor.tsx](ModelActor.tsx)) or `"building"` ([components.ts](components.ts) maps the names);
- the member's knobs: `model`, `scale`, `collidersNeverMove`, `wholeTrimesh`, `excludeColliderNames` (or a building's `hull`);
- spawn knobs: `footprint`, `density`, `clustering`, `renderDistance`, `priority`, filters (`heightRange`, `slopeRange`, `roadDistanceRange`), `flattenGround`…; its biomes are not a field (see Mount);
- simulation, which the SERVER reads through [catalog.ts](catalog.ts): `stateMachine`, `body`, `collider`, `movement`, `interactReach`, `hull`.

**Mount.** A biome's `actors` list in its `spec.ts` is everything that spawns in that biome — `actors: [{ actor: FROG_SPEC, density: 120 }]` (`ActorMount`: the spec plus that biome's overrides) — and a listed kind spawns ONLY in the biomes that list it: `<Biome>` registers it with `biomeIds` = that biome, and the domain's config.ts derives the server's flatten pads from the same lists. A kind for several biomes is listed in EACH of them (it spawns in their union; `mergeActorListings` in [spec.ts](spec.ts), one placement per kind, the last listing's other overrides win). Neither a spec nor a mount can name `biomeIds` (the type forbids it), so the lists are the one place an actor's biomes are written. A mount that overrides a hull attribute warns in dev (the server builds its sealed hull from the spec's `hull`); a mount never renames a kind — a second placement with different settings is a second spec.

**Descriptor.** `describeActor(spec)` ([../../world/components/Actor.tsx](../../world/components/Actor.tsx)) turns a spec into the client descriptor: the named component plus every spec attribute (a building's `hull` spread in). Every non-spawn attribute is forwarded to each instance as props; the spawn-only keys are listed once in `SPAWN_ONLY_KEYS` ([spawning/types.ts](spawning/types.ts)). In dev it throws when a kind the server simulates (a machine, a moving body, a hull) is missing from the catalog or differs from it, and when a `"model"` kind has no `model`. A kind the server simulates nothing for defaults to `serverSynced: false` (no entity traffic).

**The base** ([Actor.tsx](Actor.tsx)) is shared by every actor:
- `useActorLifecycle`: one shared frame driver for all actors (never a `useFrame` per actor), the camera distance, the spawn fade (every actor dithers in when its group first appears; `fadeOut: true` — ModelActor — also dithers out past `renderDistance` and then self-destroys; [../../vfx/spawnFade.ts](../../vfx/spawnFade.ts)), the hard-kill despawn, frustum visibility, distance-gated colliders, a "near" gate for dynamic content, and matrix freezing when far away.
- `prepareActorMaterial`: the only place actor materials get quantization, lamp glow, world curvature and the spawn fade.

**Members:**
- [ModelActor.tsx](ModelActor.tsx) is the standard actor: a GLTF model. It clones the model from a pool ([modelClonePool.ts](modelClonePool.ts)), builds colliders from the GLTF ([colliders/README.md](colliders/README.md), live within `colliderDistance`, default `min(500, renderDistance / 2)`) and runs the animation mixer with a distance LOD. If the spec has a `stateMachine`, it also runs the machine, the mouse raycast (within `interactReach`, default 5u), the kinematic body ([kinematicMover.tsx](kinematicMover.tsx)) and the animation channel ([animationPlayer.ts](animationPlayer.ts)). So an NPC needs no component of its own.
- [building/Building.tsx](building/Building.tsx) owns its geometry, so it calls `useActorLifecycle` directly ([building/README.md](building/README.md)).

**Body kinds** (`body`): `"fixed"` (default) uses colliders from the GLTF. `"kinematic"` is a capsule moved by the state machine (on the server when synced). `"none"` has no colliders.

**Interact reach.** `interactReach` (ray distance from the eye) is the one knob: the client's raycast registers inputs within it, and the server accepts a forwarded input from a player within `interactReach + INTERACT_REACH_SLACK` (3u: the server measures 2D from the player's last reported position to the actor's origin). A building's `door:<i>` is measured from THAT DOOR instead (its position in the seeded plan, `DOOR_INTERACT_REACH` + the same slack — [building/README.md](building/README.md)).

## How to use/add

### A static prop (a model at a position, no behavior) — 1 new file + 1 mount line (was 1 file with a descriptor + createActor, + a JSX mount)

1. Put the model in `public/models/<name>.glb`. Tag collider meshes in it if you want it solid ([colliders/README.md](colliders/README.md)).
2. Create `src/objects/actors/<name>/spec.ts`:
   ```ts
   import type { ActorSpec } from "../spec";

   export const ROCK_SPEC: ActorSpec = {
     id: "rock",                 // unique across all actors
     model: "/models/rock.glb",
     scale: [1, 1, 1],
     footprint: 6,               // spacing radius, world units
     density: 50,                // per 1,000,000 sq units
     clustering: 0.3,            // 0 uniform … 1 clumped
     renderDistance: 300,
     // optional: wholeTrimesh, excludeColliderNames, slopeRange, heightRange, priority, colliderDistance…
   };
   ```
   No catalog line: the server has nothing to simulate for it.
3. List it in a biome's `actors` (`src/world/domains/overworld/regions/<region>/biomes/<biome>/spec.ts`):
   ```ts
   actors: [{ actor: ROCK_SPEC }],   // spawns in this biome only; list it in another biome's spec to spawn there too
   ```

### An NPC (behavior + movement, synced by the server) — 2 new files + 1 catalog line + 1 mount line (was 3 files + catalog + JSX mount)

1. Model with animation clips in `public/models/<name>.glb`. Clip names are what the machine plays.
2. `src/objects/actors/<name>/stateMachine.ts`: the behavior ([state/README.md](state/README.md)).
3. `src/objects/actors/<name>/spec.ts`:
   ```ts
   import type { ActorSpec } from "../spec";
   import { FROG_SM } from "./stateMachine";

   export const FROG_SPEC: ActorSpec = {
     id: "frog",
     stateMachine: FROG_SM,
     body: "kinematic",
     collider: { shape: "capsule", radius: 0.4, height: 1.2 },
     movement: "ground", // or "free" for flyers/swimmers (no gravity)
     model: "/models/frog.glb",
     collidersNeverMove: false,
     footprint: 5, density: 100, clustering: 0, renderDistance: 200, priority: 80,
     // interactReach: 5,  // click/hover reach (the server allows +3)
   };
   ```
4. Add one line to [catalog.ts](catalog.ts): `[FROG_SPEC.id]: FROG_SPEC,` (plus its import). Forgetting it throws in dev and fails `server/test/catalog.test.ts`.
5. List `{ actor: FROG_SPEC }` in a biome's `actors` (step 3 above).

Nothing on the server needs editing. The full sync guide is [NPC_TRACKING.md](../../../NPC_TRACKING.md). For scene logic the machine cannot express, write a component that renders `<ModelActor {...props} onFrame={(state, delta, ctx) => …} />`, add it to [components.ts](components.ts) under a new name (and to `ActorComponentName` in [spec.ts](spec.ts)), and set `component: "<that name>"` on the spec. Never add a `useFrame`.

### A variant of an existing kind

Spread the base spec and change fields, as `SKYSCRAPER_SPEC` does in [building/spec.ts](building/spec.ts) (`{ ...BUILDING_SPEC, id: "skyscraper", … }`). If only the placement differs in one biome, override it on that biome's mount instead. Catalog the variant if the server simulates it.
