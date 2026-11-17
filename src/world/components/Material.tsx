import { declare } from "../content";
import type { MaterialData, RiverbedMaterial } from "../types";

export interface MaterialProps {
  /** Domain scope: the bed texture under every river that no biome overrides. */
  riverTexture?: string;
  /** The fragment shader (`void main()` writing gl_FragColor; its uniform/varying lines are stripped). */
  shader?: string;
  /** Its sampler uniforms: uniform name → filename under public/textures/. Uniform names are GLOBAL
   *  across every biome/region shader (the terrain is one material) — reuse a name only for the same file. */
  textures?: Readonly<Record<string, string>>;
  /** Instead of a shader: one flat color ("#rrggbb"), e.g. the lines of a wireframe <Terrain>. */
  color?: string;
  /** Instead of shader + textures: builds the material itself (non-texture uniforms). */
  getMaterial?: () => Promise<MaterialData>;
  /** Biome scope: the bed under this biome's rivers, cross-faded by the biome weights. */
  riverbed?: RiverbedMaterial;
}

/** The LOOK of whatever it is mounted in: under <Domain> the default riverbed texture, under a
 *  <Region> its BASE material (what its biomes fade into at their edges), under a <Biome> that
 *  biome's own fragment shader. Renders nothing — the terrain is one material, assembled from
 *  every one of these (world/terrain/material.ts). */
export const Material = declare<MaterialProps>({ kind: "material", within: ["domain", "region", "biome"] });
