import type { ChunkBounds, ColliderBody, ColliderPart } from "../../world/chunks/types";
import type { DRESSING_ENUMERATORS } from "./registry";
import type { DressingAttributes } from "../types";

/** NO Three/React here — the server (server/src/game/physics/bodies/index.ts) imports this to build the same colliders. */

export type { ChunkBounds, ColliderBody, ColliderMesh, ColliderPart } from "../../world/chunks/types";
export { WORLD_CHUNK_SIZE } from "../../world/chunks/constants";
export { yawFromDir } from "../../world/chunks/utils";

/** A dressing feature with colliders, as data the client component AND the server read — listed in
 *  catalog.ts. `placement` is the mount's prop defaults and the ONLY placement the server knows. */
export interface DressingColliderSpec<K extends DressingEnumeratorName = DressingEnumeratorName> {
  /** The feature's component name (dev warnings). */
  id: string;
  enumerator: K;
  placement: EnumeratorArgs<K>;
  /** Boxes every body shares, unless the body carries its own. */
  colliderParts: ColliderPart[];
  /** A placed point → its bodies; the yaw must match the drawn instance. */
  bodiesOf(point: EnumeratorPoint<K>): ColliderBody[];
}

export interface DensityPoint {
  x: number;
  y: number;
  z: number;
}

export interface RoadMarkerArgs {
  streetSpacing: number;
  freewaySpacing: number;
}

export interface TrafficLightArgs {
  /** Seeded fraction of eligible intersections that get signals. */
  chance: number;
}

export interface FreewayEdgeArgs {
  spacing: number;
  /** Past the freeway edge (the config's freewayWidth is added by the enumerator). */
  lateralMargin: number;
  /** Runs stop this close to a crossing freeway. */
  junctionClear: number;
  /** Which side of each freeway carries points (+1 / −1). */
  side: number;
  /** Each point also carries its successor (wire spans across chunk borders). */
  withNext?: boolean;
}

export type Enumerator<A, P> = (b: ChunkBounds, args: A) => P[];

export type DressingEnumeratorName = keyof typeof DRESSING_ENUMERATORS;
export type EnumeratorArgs<K extends DressingEnumeratorName> = Parameters<(typeof DRESSING_ENUMERATORS)[K]>[1];
export type EnumeratorPoint<K extends DressingEnumeratorName> = ReturnType<(typeof DRESSING_ENUMERATORS)[K]>[number];

/** A solid feature's mount props: its view distances only — its placement lives in its spec, the
 *  only one the server knows. Unset = the feature's own default. */
export type SolidDressingProps = Pick<DressingAttributes, "renderDistance" | "colliderDistance">;

export interface InstancePlacement {
  x: number;
  y: number;
  z: number;
  yaw?: number;
}
