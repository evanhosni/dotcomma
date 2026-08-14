import { GameObjectAttributes } from "../types";
import { createDefaultsGroup } from "../utils";

/**
 * FOLIAGE — the mass-GPU-vegetation class of the game-object hierarchy (see
 * objects/types.ts for the class overview and the shared base attributes).
 *
 * The three classes, by scale and statefulness:
 *   - ACTORS   (objects/actors/, registered via world/components/Actor.tsx):
 *     per-object spawns with identity/state/interaction — one React component
 *     each (beebles, buildings). Hundreds mounted at once, tops.
 *   - DRESSING (objects/dressing/Dressing.tsx): mass stateless rigid scenery —
 *     InstancedMeshes assembled on the main thread from worker point lists,
 *     ~10²–10³ instances per 256u chunk (lamps, markers, signals, poles).
 *   - FOLIAGE  (this file): vegetation at yet another order of magnitude —
 *     up to ~16k instances per 32u chunk, so placement streams from its
 *     worker as transferable Float32Arrays STRAIGHT into GPU instance
 *     attributes (never per-point JS objects), and all animation
 *     (billboarding, wind sway) runs in the vertex shader. Per-chunk
 *     bounding spheres keep frustum culling effective at this density.
 *
 * Foliage deliberately does NOT extend the Dressing chunk base: Dressing's
 * point-list → Matrix4-per-instance assembly would be a regression at
 * foliage instance counts. A foliage feature owns its chunk pipeline (see
 * grass/GrassField.tsx — the reference implementation); this module holds
 * the class definition and the shared <Foliage> group.
 */

/** Shared defaults for a biome's foliage features (base game-object
 *  attributes; features fall back to their own defaults when neither prop
 *  nor group sets one). */
export type FoliageDefaults = Pick<GameObjectAttributes, "renderDistance">;

/**
 * Groups a biome's foliage, mirroring <Actors>/<Dressing>: props set here
 * act as shared defaults for the children — a child's own props always win
 * (shared group pattern: objects/utils.tsx).
 *
 *   <Foliage renderDistance={140}>
 *     <GrassField color="#6a9c45" />
 *   </Foliage>
 */
const FoliageGroup = createDefaultsGroup<FoliageDefaults>();
export const Foliage = FoliageGroup.Group;

/** Resolve a feature's renderDistance: own prop > <Foliage> group > feature default. */
export const useFoliageRenderDistance = (
  own: number | undefined,
  featureDefault: number
): number => {
  const ctx = FoliageGroup.useDefaults();
  return own ?? ctx.renderDistance ?? featureDefault;
};
