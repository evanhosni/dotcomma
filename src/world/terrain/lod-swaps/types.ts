import type { PointXZ } from "../../../utils/math/types";

export interface SwapChunk {
  key: string;
  /** World-space center. */
  offset: PointXZ;
  lod: { chunkSize: number };
  built: boolean;
  drawn: boolean;
  /** The swap this chunk is fading in or out of; null = opaque when drawn. */
  transition: LodTransition<SwapChunk> | null;
  fadeLo: number;
  fadeHi: number;
}

export interface LodTransition<C extends SwapChunk> {
  /** 0 → only the old chunks show, 1 → only the new ones. */
  p: number;
  olds: C[];
  news: C[];
}

export interface SwapHooks<C extends SwapChunk> {
  isDesired(key: string): boolean;
  /** Frees the chunk (mesh, water, collider) and drops it from the chunk map. */
  destroy(chunk: C): void;
  /** `drawn`, `transition` or the range changed in a way the renderer must reflect (visibility, material). */
  redraw(chunk: C): void;
}
