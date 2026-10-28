import type { RockPlacementParams, RockPoint } from "../../../utils/workers/vertexCompute";
import type { ColliderBody, DressingColliderSpec } from "../types";
import { ROCK_SHAPES, rockLumpVertices } from "./shapes";

// Three-free: the rock art (Rocks.tsx), the client colliders AND the server's (physics/obstacles.ts)
// are built from these, so a rock is solid exactly where it is drawn on both.

/** Drawn as one merged mesh per chunk out to here; a lump is solid only near the player. */
export const ROCK_RENDER_DISTANCE = 1400;
export const ROCK_COLLIDER_DISTANCE = 60;

/** The darker and the lighter rock, mixed by each rock's shade. */
export const ROCK_SHADE_DARK = 0x5a5753;
export const ROCK_SHADE_LIGHT = 0x8e8a84;

/** The fields themselves come from the biomes that mount <Rocks/>, each with its own props
 *  (rocks/params.ts). Only what is true of every field is here. */
export const ROCK_PLACEMENT: RockPlacementParams = { roadClear: 3 };

/** One body per rock: exactly the drawn lump as a trimesh, under the rock's yaw and pitch. */
const rockColliderBodies = (rock: RockPoint): ColliderBody[] => [
  {
    x: rock.x,
    y: rock.y,
    z: rock.z,
    yaw: rock.yaw,
    pitch: rock.pitch,
    parts: [],
    mesh: { vertices: rockLumpVertices(rock.variant, rock.sx, rock.sy, rock.sz), indices: ROCK_SHAPES[rock.variant].indices },
  },
];

export const ROCKS_SPEC: DressingColliderSpec<"rocks"> = {
  id: "Rocks",
  enumerator: "rocks",
  placement: ROCK_PLACEMENT,
  colliderParts: [],
  bodiesOf: rockColliderBodies,
};
