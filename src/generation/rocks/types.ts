

/** Rocks on a biome (`rocks: true | {…}`): a density field kept by slope, and the rock's texture. */
export interface RockParams {
  /** Rocks per km². */
  density: number;
  footprint: number;
  sizeMin: number;
  sizeMax: number;
  /** The share of flat points kept; every point is kept between `startDeg` and `fullDeg` of slope. */
  flatKeep: number;
  startDeg: number;
  fullDeg: number;
  /** Filename under public/textures/. */
  texture: string;
}

export interface RockField extends RockParams {
  /** Seed namespace of the density grid: `rocks-<biome name>`, so a field's rocks never move. */
  seedTag: string;
  biomeIds: number[];
}

export interface RockPlacementParams {
  /** Past a road's or freeway's paved half width. */
  roadClear: number;
}

export interface RockPoint {
  x: number;
  y: number;
  z: number;
  variant: number;
  /** Half sizes along the rock's own axes. */
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  pitch: number;
  /** 0–1 between the darker and the lighter rock color. */
  shade: number;
  /** The lowest drawn ground under its footprint. */
  ground: number;
  /** 1 when snow lies on its up-facing faces (its biome's `snow` flag), 0 bare (a boulder in a waterfall). */
  snow: number;
}

/** A rock's look, seeded from its position: shape, half sizes, yaw, tilt, shade and how deep it sinks. */
export interface RockLook {
  variant: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  pitch: number;
  shade: number;
  /** The share of its height under its lowest ground. */
  bury: number;
}
