/**
 * THE GAME-OBJECT HIERARCHY — the attribute types of everything placed in the
 * world, in one file so the whole shape is visible at once:
 *
 *   GameObjectAttributes          every class
 *   ├─ ActorAttributes            + what only actors have
 *   │   ├─ ModelActorAttributes   + GLTF-model actors (actors/ModelActor.tsx)
 *   │   └─ BuildingAttributes     + procedural buildings (actors/building/types.ts)
 *   ├─ DressingAttributes         + what only dressing has (nothing class-wide today)
 *   └─ FoliageAttributes          + what only foliage has
 *
 * A MEMBER's attributes live next to the member; the class layers live here.
 * Runtime-shaped types wrap these: ActorDescriptor<A> / ActorProps<A>
 * (objects/actors/spawning/types.ts — every attribute on a descriptor is
 * forwarded to each spawned instance as props), the per-feature dressing
 * props. A field lives at the HIGHEST level where at least two users share it;
 * a field only one class or member uses lives in that block.
 *
 * EVERY placed thing in the game belongs to exactly one of three classes and
 * is built on that class's BASE, which owns all of the behavior its members
 * share (by scale and statefulness):
 *
 *   - ACTORS   — base: objects/actors/Actor.tsx
 *     Per-object spawns with identity, state, or interaction — beebles,
 *     buildings. One React component each, mounted through the spawn
 *     lifecycle (objects/actors/spawning/ActorPool.tsx). Hundreds at once, tops.
 *   - DRESSING — base: objects/dressing/Dressing.tsx
 *     Mass stateless identical scenery — street lamps, road markers, traffic
 *     lights, power lines. InstancedMesh per 256u chunk, zero per-object
 *     components.
 *   - FOLIAGE  — base: objects/foliage/Foliage.tsx
 *     Mass GPU vegetation — up to ~16k instances per 32u chunk, placement
 *     streamed as Float32Arrays straight into GPU instance attributes,
 *     animation in the vertex shader.
 *
 * Rule of thumb: unique geometry/interaction/behavior → actor; many +
 * identical + stateless → dressing; thousands-per-chunk vegetation → foliage.
 * The class boundaries are MEASURED perf boundaries — rendering the dressing
 * set as actors cost ~10–20 fps; foliage at dressing's Matrix4-per-instance
 * assembly would regress the same way.
 *
 * The bases are not optional and they are not a style preference: a
 * world-wide effect (world curvature, vertex quantization, lamp glow, the
 * shared frame driver, GPU warm-up) is implemented ONCE in each base, and an
 * object gets it by belonging to a class. An object that hand-rolls what its
 * base already does will silently miss the next one.
 */

import type * as THREE from "three";

// ── EVERY class ──────────────────────────────────────────────────────────────

/** Attributes shared by every game-object class. All optional here — a class's
 *  descriptor/props type re-declares the ones it requires. */
export interface GameObjectAttributes {
  /** Camera distance at which the object (or its chunk) renders/mounts. */
  renderDistance?: number;
  /** Camera distance within which real physics colliders exist (actors:
   *  default renderDistance / 3; dressing: DRESSING_COLLIDER_DISTANCE).
   *  Foliage has no colliders and ignores it. */
  colliderDistance?: number;
  /** Vertex quantization grid size override; unset = the global grid
   *  (set by <PostProcessing quantization>). Dressing is never quantized
   *  (instanced positions are rebased — see Dressing.tsx) and ignores it. */
  quantization?: number;

  // Placement filters — evaluated against the shared vertex pipeline
  // (utils/workers/vertexCompute.ts) by every class's worker.
  /** Restrict to specific biomes (unset = every biome). */
  biomeIds?: number[];
  /** Restrict to a terrain height band. */
  heightRange?: [number, number];
  /** Restrict to a slope range (degrees). */
  slopeRange?: [number, number];
  /** Restrict by distance to the city road centerline, in normalized street
   *  units (keeps buildings off roads, puts lamps on sidewalks). */
  roadDistanceRange?: [number, number];

  // Density placement — the common placement model of actors, density-placed
  // dressing (street lamps) and foliage. Structured dressing (markers,
  // signals, poles) places from enumerators and ignores these.
  /** Instances per 1,000,000 sq units. */
  density?: number;
  /** Radius in world units for spacing/packing (foliage does not space). */
  footprint?: number;
}

// ── ACTOR ────────────────────────────────────────────────────────────────────

/** Attributes only actors have — the per-object spawn class. */
export interface ActorAttributes extends GameObjectAttributes {
  /** 0 = uniform, 1 = heavily clustered. */
  clustering?: number;
  /** 0 = rarest (placed first), 100 = common. Default 50. */
  priority?: number;
  /** Custom min distance vs other descriptor ids. */
  spacingOverrides?: Record<string, number>;
  /** Hard unmount distance. Default (renderDistance + footprint/2) * 1.2. */
  despawnDistance?: number;
  /** Inner radius where despawned objects can't REspawn. Default spawn radius * 0.5. */
  immediateRadius?: number;
  /** Bounds-radius multiplier for the frustum test. Default 3. */
  frustumPadding?: number;
  /** true = always grow the cursor on hover, false = never, unset = from triggers. */
  cursorOverride?: boolean;
  /** Multiplayer sync. Default TRUE: the actor BASE registers every instance
   *  with the SERVER, which runs the actor's state machine (the same config
   *  file, see state/runner.ts) as the ONE authority and publishes pose, clip
   *  and state; every client is placed to match (net/entities). The component
   *  never knows. `false` at a mount opts that mount out (purely local). */
  serverSynced?: boolean;
  /** The terrain flattens a PAD under every instance (buildings, houses — any
   *  biome). Placement becomes fully DETERMINISTIC (stateless greedy spacing
   *  instead of the spatial hash) so the height function can replicate it —
   *  see the flatten-pad engine in utils/workers/vertexCompute.ts. */
  flattenGround?: boolean;
  /** Flat pad radius; default footprint * 0.45. */
  flattenRadius?: number;
  /** Blend ring back to raw terrain; default footprint * 0.35. */
  flattenSkirt?: number;
}

// ── DRESSING ─────────────────────────────────────────────────────────────────

/** Attributes only dressing has. There are none class-wide today: every
 *  dressing feature's remaining knobs (marker spacing, signal chance, pole
 *  lateral offset) belong to that feature's placement enumerator, so they live
 *  on the feature's own props. Kept as the class's extension point. */
export interface DressingAttributes extends GameObjectAttributes {}

// ── FOLIAGE ──────────────────────────────────────────────────────────────────

/** Attributes only foliage has — every knob of the foliage pipeline
 *  (Foliage.tsx). A plant type (grass, shrub, …) is these with different
 *  defaults; see createFoliage. */
export interface FoliageAttributes extends GameObjectAttributes {
  /** Degrees over which density fades and instances shorten at the
   *  slopeRange edges. */
  slopeBlend?: number;
  /** Tint multiplied over the texture (pass "#fff" to keep a texture's own colors). */
  color?: string;
  /** Billboard texture path (alpha-tested), loaded from the public URL. */
  png?: string;
  /** Procedural billboard texture, for plants drawn in code instead of loaded.
   *  MUST be a stable module-level function — its identity keys the material. */
  texture?: () => THREE.Texture;
  /** Billboard width in world units. */
  width?: number;
  /** Billboard height in world units. */
  height?: number;
  /** Max tip displacement in world units — 0 disables sway. */
  sway?: number;
  /** Wind animation speed multiplier. */
  swaySpeed?: number;
  /** Deterministic placement seed. Two fields with the SAME seed and density
   *  land on the same points — vary it to decorrelate them. */
  seed?: string;
}
