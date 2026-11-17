

export interface LODLevel {
  level: number;
  chunkSize: number;
  segments: number;
  maxDistance: number;
  hasCollider: boolean;
  /** Vertical skirt around the chunk edge hiding the seam to a coarser neighbor. The FINER
   *  chunk's skirt must exceed the worst height its coarser neighbor's straight segment
   *  misses by, which grows with vertex spacing. Worst gaps along four map-spanning lines of
   *  the overworld (with the mountain domes, at the coarser spacings of the time): LOD1|2 3u, LOD2|3 192u,
   *  LOD3|4 398u, hence 30 / 230 / 460. Finer segments only shrink the gaps. LOD4 is the outermost ring, with
   *  no coarser neighbor, so its 1000 only hangs past the far plane. */
  skirtDepth: number;
  /** Whether the chunk evaluates the river field (channel, river water, bed paint, city quay). LOD4
   *  (210u spacing) does not: a river there drew isolated specks of water while the field's road layer
   *  was most of its build time. It reads the coarse FAR field instead (generation/water/rivers/field/index.ts farRiverFieldAt:
   *  the walls and the valleys' gap), so its land keeps the water's shape. LOD3 (70u) keeps the real
   *  field: it still draws a wide river near the ocean. */
  carvesRivers: boolean;
  /** Whether a collider LOD cuts the ground under bridge decks (computeVertexData step 11: the cut, the
   *  landing approaches, the mouths) and bulges the ground at cave mouths; the visual-only LODs never do
   *  (their path has no decks). LOD2 KEEPS it: off, its cold build was 28–45% faster at bridge areas
   *  (enumerating a cell's decks), but the bowed approach road rose up to 7.5u through a deck's landed
   *  end (2 of 15 decks, ≤ 0.8u on the rest), a mound of several pixels at 420–600u that popped flat
   *  when LOD1 took over. */
  cutsDecks: boolean;
  /** Clamp the biome blend fields to where the shader saturates (sdf ±1, presence 0..1) before
   *  upload — exact at every vertex, and it makes them interpolate as a plain cross-fade. Unclamped,
   *  a slot reads ±BIOME_SDF_FAR where no wall is in reach and ±(distance / feather half) elsewhere,
   *  so across a coarse triangle spanning three zones (or a far and a near value) EVERY slot
   *  interpolates below -1: zero weight, a BLACK pixel (black patches on the horizon). Only on
   *  LODs whose vertex spacing already cannot resolve a feather; the near LODs keep the true
   *  distances, which put a 1u city edge exactly where it belongs on a 4.375u quad. */
  clampBlendFields: boolean;
}

export type DesiredChunks = { [key: string]: { position: number[]; lod: LODLevel } };
