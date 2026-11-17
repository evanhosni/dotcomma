export interface TerrainHole {
  kind: "shaft" | "mouth";
  id: string;
  /** A shaft: the center at the street (a = b); a mouth: the section from the opening to its inner end. */
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  radius: number;
  /** The entrance fade's share of the cut (a shaft: 1). */
  share: number;
  /** A mouth: how far over the section's floor (interpolated along it) the cut reaches; a shaft: unused. */
  capHeight: number;
  /** A mouth: how far past `radius` the entrance PATCH keeps drawing (the footprint band both draw); a shaft: 0. */
  band: number;
  /** A mouth: the height of its daylight's point over (ax, az) (generation/underground/field/index.ts mouthLightY); a shaft: unused. */
  lightY: number;
}

export interface TunnelMask {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  radius: number;
  /** The top of the tunnel air it holds (SkirtMask.ceiling). */
  ceiling: number;
}
