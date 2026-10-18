/** The tunnels' data model: systems as the generators build them and the chunks the tunnel worker sends.
 *  Three-free (the server bundles the generators, the main thread the player probe). */

export type TunnelStyle = "cave" | "sewer";

export interface Bounds3 {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

interface PieceBase {
  /** The system's key; pieces of one system meet smoothly, systems only overlap. */
  system: string;
  /** Pieces of one path union plainly; different paths of a system meet in the smooth junction. */
  path: number;
  bounds: Bounds3;
}

/** A passage segment between two FLOOR points: a round tube of radius ra→rb whose axis stands
 *  AXIS_LIFT radii over the floor, cut flat at the floor. `bulge` (fraction of the radius) and
 *  `bump` (u) are the wall noise and floor bumps at each end. */
export interface TubePiece extends PieceBase {
  kind: "tube";
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  ra: number;
  rb: number;
  bulgeA: number;
  bulgeB: number;
  bumpA: number;
  bumpB: number;
}

/** A mouth section: straight from the opening's floor point (ox, oy, oz) along the unit (dx, dz)
 *  into the mountain for `length`, the floor descending at `grade`, radius r0 narrowing to r1,
 *  the outline ragged by `phase`. */
export interface MouthPiece extends PieceBase {
  kind: "mouth";
  id: string;
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dz: number;
  length: number;
  r0: number;
  r1: number;
  grade: number;
  phase: number;
  /** The widest outline: r0 × (1 + MOUTH_RIM_AMP). */
  width: number;
  /** Where the rock dressing stands this mouth's rocks (set after generation, on the bulged ground). */
  spots: RockSpot[];
}

/** A short wide capsule off a path, cut flat at its floor (the path's at either end). */
export interface RoomPiece extends PieceBase {
  kind: "room";
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  radius: number;
}

/** A stalactite (dir −1, hanging from its root) or stalagmite (dir +1): ROCK in the field. */
export interface ConePiece extends PieceBase {
  kind: "cone";
  x: number;
  y: number;
  z: number;
  length: number;
  radius: number;
  dir: 1 | -1;
}

/** A sewer box (junction, room, side room, doorway reveal, a room's pool): air above `floor` for
 *  `height`, turned by (cos, sin) about its center. */
export interface BoxPiece extends PieceBase {
  kind: "box";
  cx: number;
  cz: number;
  floor: number;
  height: number;
  halfX: number;
  halfZ: number;
  cos: number;
  sin: number;
}

/** A sewer pipe from node middle A to node middle B: the walkways at floorA/floorB (flat over
 *  flatA/flatB from each end, sloping between), the round pipe over them and the channel. */
export interface PipePiece extends PieceBase {
  kind: "pipe";
  ax: number;
  az: number;
  bx: number;
  bz: number;
  floorA: number;
  floorB: number;
  flatA: number;
  flatB: number;
}

/** A manhole shaft: a vertical cylinder from `bottom` up to the street (+ SHAFT_ABOVE_STREET when open). */
export interface ShaftPiece extends PieceBase {
  kind: "shaft";
  id: string;
  x: number;
  z: number;
  radius: number;
  bottom: number;
  street: number;
}

export type TunnelPiece = TubePiece | MouthPiece | RoomPiece | ConePiece | BoxPiece | PipePiece | ShaftPiece;

export interface RockSpot {
  x: number;
  z: number;
  size: number;
}

/** A rigid disc's rest: center and unit normal. */
export interface DiscPose {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

export interface ManholeInfo {
  floorY: number;
  ceilingY: number;
  streetY: number;
  exitX: number;
  exitY: number;
  exitZ: number;
  /** The ladder faces this way (the exit's direction). */
  faceX: number;
  faceZ: number;
  /** The street under the frame: FRAME_SAMPLES angles × (inner, outer) radius, the higher of the
   *  drawn and the exact ground. */
  frameGround: Float32Array;
  closed: DiscPose;
  aside: DiscPose;
}

export interface TunnelEntrance {
  kind: "mouth" | "manhole";
  id: string;
  /** A mouth: the opening's floor point; a manhole: the shaft's center at the street. */
  x: number;
  y: number;
  z: number;
  /** Unit direction INTO the tunnel (a mouth) or the ladder's face (a manhole). */
  dirX: number;
  dirZ: number;
  radius: number;
  manhole?: ManholeInfo;
}

/** A capsule the terrain's skirts are discarded inside. */
export interface SkirtMask {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  radius: number;
}

export interface SewerDoor {
  id: string;
  /** The hinge frame's origin at the reveal's far face; +z (after `yaw`) into the side room. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
}

export interface TunnelSystem {
  key: string;
  style: TunnelStyle;
  biomeId: number;
  ix: number;
  iz: number;
  pieces: TunnelPiece[];
  mouths: MouthPiece[];
  entrances: TunnelEntrance[];
  masks: SkirtMask[];
  bounds: Bounds3;
  /** Sewers: the district the system's streets belong to (systems of one district are merged). */
  district?: string;
  /** A spring cave's standing water (caves.ts planSpring and the finishes): drawn by the TERRAIN's water
   *  sheet (springWater.ts), swum in through the chunk's liquid triangles like the sewers'. */
  liquid?: SpringWater[];
}

/** One convex polygon of a spring cave's water, absolute, with the depth the water sheet draws it at
 *  and the flow of its surface (world/water: 0 on a pool, downhill through a hall). */
export interface SpringWater {
  points: [number, number, number][];
  depth: number;
  flowX: number;
  flowZ: number;
}

export interface TunnelMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  daylight: Float32Array;
  indices: Uint32Array;
}

/** A sewer chunk's END CAP toward one neighbouring dressing chunk ("minX,minZ"): a face across every
 *  tube that border cuts, drawn only while that neighbour is not loaded, so an unloaded far end shows
 *  wall and not the world outside. Relative like the mesh. */
export interface TunnelCap {
  neighbor: string;
  mesh: TunnelMesh;
}

export interface ColumnCollider {
  x: number;
  z: number;
  /** x/z relative to the column's middle, y absolute. */
  vertices: Float32Array;
  indices: Uint32Array;
}

/** The entrance patch: ground and walls as one surface, carrying the terrain's per-vertex fields
 *  (the terrain program draws it) plus the rock share and daylight in `entranceRock`. */
export interface EntrancePatch {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  biomeSdf0: Float32Array;
  biomeSdf1: Float32Array;
  biomePresence0: Float32Array;
  biomePresence1: Float32Array;
  riverbedSdf0: Float32Array;
  riverbedSdf1: Float32Array;
  riverBedDistance: Float32Array;
  distanceToRoadCenter: Float32Array;
  distanceToFreewayCenter: Float32Array;
  freewayAlong: Float32Array;
  underwaterDepth: Float32Array;
  entranceRock: Float32Array;
}

export interface UndergroundChunk {
  style: TunnelStyle;
  centerX: number;
  centerZ: number;
  /** Every piece of air reaching the chunk (padded by FIELD_REACH): the player probe's field. */
  pieces: TunnelPiece[];
  /** The entrances standing in this chunk. */
  entrances: TunnelEntrance[];
  /** Every entrance of the chunk's systems (daylight, the far mouths). */
  systemEntrances: TunnelEntrance[];
  masks: SkirtMask[];
  /** Positions relative to (centerX, 0, centerZ). */
  mesh: TunnelMesh;
  colliders: ColumnCollider[];
  /** Sewers: the liquid surface, relative like the mesh. */
  liquid: { positions: Float32Array; indices: Uint32Array } | null;
  patch: EntrancePatch | null;
  /** Per mouth whose footprint reaches this chunk, every dressing chunk ("minX,minZ") it spans. */
  entranceMouths: { id: string; cells: string[] }[];
  doors: SewerDoor[];
  /** Sewers: the border caps, per neighbour chunk. */
  caps: TunnelCap[];
}
