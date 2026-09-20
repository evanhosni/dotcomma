// Same biome id as the grass region's GrassBiome: registrations merge at commit
// (last wins), so the two MUST resolve to the same material — re-export, never copy.
export { getMaterial } from "../../../grass/biomes/grass/material";
