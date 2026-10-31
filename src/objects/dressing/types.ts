/** NO Three/React here — the server (physics/obstacles.ts) imports this to build the same colliders. */

import type { ColliderBody, ColliderPart } from "../../world/chunks/types";
import type { DressingEnumeratorName, EnumeratorArgs, EnumeratorPoint } from "./enumerators";

export type { ChunkBounds, ColliderBody, ColliderMesh, ColliderPart } from "../../world/chunks/types";
export { WORLD_CHUNK_SIZE, yawFromDir } from "../../world/chunks/types";

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
