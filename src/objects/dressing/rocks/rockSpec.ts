import type { RockPlacementParams, RockPoint } from "../../../utils/workers/vertexCompute";
import type { DressingColliderBody, DressingColliderSpec } from "../types";
import { ROCK_SHAPES, rockLumpVertices } from "./rockShapes";

// Three-free: the rock art (Rocks.tsx), the client colliders AND the server's (physics/obstacles.ts)
// are built from these, so a rock is solid exactly where it is drawn on both.

/** Drawn as one merged mesh per chunk out to here; a lump is solid only near the player. */
export const ROCK_RENDER_DISTANCE = 1400;
export const ROCK_COLLIDER_DISTANCE = 60;

/** The darker and the lighter rock, mixed by each rock's shade. */
export const ROCK_SHADE_DARK = 0x5a5753;
export const ROCK_SHADE_LIGHT = 0x8e8a84;

/** The one `<Rocks/>` mount (the mountain's) covers the snow region: two fields. Tundra 6, mountain 7
 *  (their specs' ids); the slope keep makes the mountain's steep ground the rockiest. */
export const ROCK_PLACEMENT: RockPlacementParams = {
  fields: [
    { seedTag: "rocks-mountain", biomeIds: [7], density: 900, footprint: 5, sizeMin: 0.4, sizeMax: 13.5, flatKeep: 0.12, startDeg: 10, fullDeg: 32 },
    { seedTag: "rocks-tundra", biomeIds: [6], density: 110, footprint: 6, sizeMin: 0.4, sizeMax: 3, flatKeep: 0.3, startDeg: 8, fullDeg: 25 },
  ],
  roadClear: 3,
};

/** One body per rock: exactly the drawn lump as a trimesh, under the rock's yaw and pitch. */
const rockColliderBodies = (rock: RockPoint): DressingColliderBody[] => [
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
