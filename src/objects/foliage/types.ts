import * as THREE from "three";
import { DensityPlacement, GameObjectAttributes } from "../types";

/**
 * FOLIAGE props — every knob of the foliage pipeline (Foliage.tsx). A plant
 * type (grass, shrub, …) is these props with different defaults; see
 * createFoliage.
 */
export interface FoliageProps extends GameObjectAttributes, DensityPlacement {
  /** Instances per 1,000,000 sq units (same scale as ActorDescriptor.density). */
  density?: number;
  /** Restrict to a slope range, in degrees. */
  slopeRange?: [number, number];
  /** Degrees over which density fades and instances shorten at the
   *  slopeRange edges. */
  slopeBlend?: number;
  /** Tint multiplied over the texture (pass "#fff" to keep a texture's own colors). */
  color?: string;
  /** Billboard texture path (alpha-tested), loaded from the public URL. */
  png?: string;
  /** Procedural billboard texture, for plants drawn in code instead of loaded.
   *  MUST be a stable module-level function — its identity keys the material. */
  texture?: () => THREE.Texture;
  /** Billboard size in world units. */
  width?: number;
  height?: number;
  /** Max tip displacement in world units — 0 disables sway. */
  sway?: number;
  /** Wind animation speed multiplier. */
  swaySpeed?: number;
  /** Max camera distance; instances shrink out near the edge. */
  renderDistance?: number;
  /** Deterministic placement seed. Two fields with the SAME seed and density
   *  land on the same points — vary it to decorrelate them. */
  seed?: string;
}
