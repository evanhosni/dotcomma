import type { DressingColliderSpec } from "../types";
import { rockColliderBodies } from "../rocks/spec";

// Three-free: the client's colliders AND the server's (physics/obstacles.ts) are built from this. Where
// the boulders stand comes from the <WaterfallBoulders/> mount in the config, which the server shares.

export const WATERFALL_BOULDERS_SPEC: DressingColliderSpec<"waterfallBoulders"> = {
  id: "WaterfallBoulders",
  enumerator: "waterfallBoulders",
  placement: {},
  colliderParts: [],
  bodiesOf: rockColliderBodies,
};
