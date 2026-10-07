# Game objects — decisions

> Moved verbatim from CLAUDE.md (Oct 2026) to keep it under the context limit. Section names quoted in the text ("Blending", "Rivers", …) refer to the other decision docs listed in CLAUDE.md under "Where the docs are".

**Game objects**
- **Actors live outside biome folders** because one kind may be placed in several biomes; a kind is only its `spec.ts` (+ `stateMachine.ts`). Every actor renders as `ModelActor` or `Building`, so no actor owns a component file, and `ModelActor` owns the behavior wiring (runner, mouse events, kinematic body, animation channel) for any spec with a `stateMachine`: an NPC is a spec + a machine and no component. A custom member gets extra per-frame work through the `onFrame` PROP — never its own `useFrame`. A clone-pool MISS builds the clone on the task queue and renders null until it lands (the same peek-then-queue pattern as `<Building>`).
- **The per-object street-lamp ACTOR was removed**: a lamp is mass, identical, stateless scenery — dressing by definition — and the duplicate meant shared object logic had to be applied twice. Freeway BARRIERS (both sides at lateral ≈ `freewayWidth + 1.3` on the freeway-edge enumerator) were built and removed by preference. Street lamps have no per-lamp edge fade (poles are thin enough to pop at 440u).
- **Foliage is deliberately NOT built on the dressing chunk base**: ~32k instances per 64u chunk means placement streams from the worker as transferable Float32Arrays straight into GPU instance attributes and all animation runs in the vertex shader.
- **Traffic-light glow trails a state switch by ≤ ~0.3s** (the glow grid rewrites every ~20 frames) — accepted.

## Actor spawn lifecycle

### Actor Spawn Lifecycle

(The ACTOR class only — dressing has its own, simpler lifecycle: whole chunks mount/unmount around the camera, see `src/objects/dressing/Dressing.tsx`.)

Deterministic spawn points come from `spawn.worker.ts` (per-descriptor density grid + probability roll + spatial-hash spacing, cached per 250u chunk; cache entries carry their world-space CENTER and their spatial-hash membership, so the eviction sweep is a distance test rather than key parsing, and evicting a chunk also removes its points from the spatial hash — stale copies would otherwise block their own deterministic regeneration when the player returns). Delivered chunks are ALSO cached client-side (`spawnWorker.ts`), so the pool's every-5-frames batch only round-trips the worker for chunks it hasn't seen — steady-state batches serialize nothing over postMessage; `cleanupSpawnCache` evicts both caches with the same radius rule. `ActorPool.tsx` mounts/unmounts them with a size-aware multi-radius hysteresis:

- `immediateRadius = spawnRadius * 0.5` (or `desc.immediateRadius`) — inner zone: initial spawns allowed, REspawns blocked
- `spawnRadius = renderDistance + footprint/2` — points inside it mount (big objects spawn sooner); between immediate and spawn radius, respawns are allowed so a camped area keeps repopulating as NPCs wander off
- `despawnRadius = spawnRadius * 1.2` (or `desc.despawnDistance`) — mounted objects beyond it are unmounted by the pool sweep; the pool also passes radii to spawned components (`renderDistance` prop = fade start, `despawnDistance` prop = self-despawn hard kill) so all radii have one source
- **Initial spawns have NO inner exclusion zone** — a point newly entering the spawn radius mounts at any distance, so spawning catches up when the player outruns spawn batches
- **Only REspawns are blocked, and only in the immediate radius**: when an object self-destroys (`onDestroy` — NPC walked away, fade-out kill), its id enters a despawn ledger; the entry clears (after a 1s cooldown) once its spawn point is outside the immediate radius, allowing the respawn. Nothing is ever permanently despawned, and ids are position-based so an object can never be duplicated.

## Why the bases own shared logic

(this is exactly what happened before the bases were consolidated: adding curvature needed six separate patch sites)

## Every object extends its class base

- **Every object extends its class base** — the load-bearing rule of `objects/`. Descriptors/props extend the attribute hierarchy in `objects/types.ts` (`GameObjectAttributes` → `ActorAttributes`/`DressingAttributes`/`FoliageAttributes` → member attributes like `ModelActorAttributes`/`BuildingAttributes`); an ACTOR is a `<ModelActor>` or uses `useActorLifecycle` (`actors/Actor.tsx`); DRESSING uses `useDressingChunks`/`useDressingAssets` (`dressing/Dressing.tsx`); FOLIAGE is `createFoliage(defaults)` (`foliage/Foliage.tsx`). Actor variants spread a base descriptor (skyscraper); every actor is ONE Three-free spec (`describeActor(spec)` builds its client descriptor; the server's catalog is derived from the biome specs that place it); group components come from `createDefaultsGroup`. Shared behavior goes IN the base — if you are about to apply a world-wide effect inside one object's file, that object is bypassing its base.
