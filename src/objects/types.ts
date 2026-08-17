/**
 * THE GAME-OBJECT HIERARCHY — shared base attributes for everything placed
 * in the world.
 *
 * EVERY placed thing in the game belongs to exactly one of three classes and
 * is built on that class's BASE, which owns all of the behavior its members
 * share (by scale and statefulness):
 *
 *   - ACTORS   — base: objects/actors/Actor.tsx
 *     Per-object spawns with identity, state, or interaction — beebles,
 *     buildings. One React component each, mounted through the spawn
 *     lifecycle (objects/spawning/ObjectPool.tsx). Descriptor type:
 *     ActorDescriptor (objects/spawning/types.ts). Hundreds at once, tops.
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

/** Attributes shared by EVERY game-object class. */
export interface GameObjectAttributes {
  /** Camera distance at which the object (or its chunk) renders/mounts. */
  renderDistance?: number;
  /** Vertex quantization grid size override; unset = the global grid
   *  (set by <PostProcessing quantization>). */
  quantization?: number;
}

/** Spawn-location restrictions shared by every placed class, evaluated
 *  against the shared vertex pipeline (utils/workers/vertexCompute.ts). */
export interface PlacementFilters {
  /** Restrict to specific biomes (unset = every biome). */
  biomeIds?: number[];
  /** Restrict to a height band. */
  heightRange?: [number, number];
  /** Restrict to a slope range (degrees). */
  slopeRange?: [number, number];
  /** Restrict by distance to the city road centerline, in normalized street
   *  units (keeps buildings off roads, puts lamps on sidewalks). */
  roadDistanceRange?: [number, number];
}

/** Density-based placement — the common placement model of actors,
 *  density-placed dressing (street lamps), and foliage. */
export interface DensityPlacement extends PlacementFilters {
  /** Instances per 1,000,000 sq units. */
  density?: number;
  /** Radius in world units for spacing/packing. */
  footprint?: number;
}
