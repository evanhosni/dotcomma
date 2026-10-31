// The one biome id the shared pipeline branches on (workers cannot import biome folders): the city,
// whose heights are bespoke. Every other id lives only in its <Biome>, and ids are asserted unique
// when a domain config is assembled (world/content/config.ts).
export const CITY_BIOME_ID = 1;

/** The vertex quantization lattice (u) the overworld's <PostProcessing> snaps every vertex to in the
 *  shader (vfx/quantization.ts). The sewers' explicit faces are snapped to it in float64 before they are
 *  written (underground/sewerMesh.ts): the pipe's end ring and the wall's arch outline are separate
 *  vertices of the same points, and snapped a step apart by the shader they left a dotted seam along
 *  every join. Changing one without the other reopens it. */
export const QUANTIZATION_GRID = 0.025;
