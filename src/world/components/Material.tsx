import { _material } from "../../utils/material";
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

const BUILDERS = new WeakMap<object, () => Promise<MaterialData>>();

/** "#rrggbb" → a fragment shader painting it. */
const flatColorShader = (hex: string): string => {
  const channel = (i: number) => (parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255).toFixed(4);
  return `void main() { gl_FragColor = vec4(${channel(0)}, ${channel(1)}, ${channel(2)}, 1.0); }`;
};

/** A <Material>'s builder: its own `getMaterial`, else one assembled from its shader + textures or its
 *  color (memoized per props object, which is stable while its element is). */
export const materialBuilderOf = (props: MaterialProps): (() => Promise<MaterialData>) | undefined => {
  if (props.getMaterial) return props.getMaterial;
  const shader = props.shader ?? (props.color && flatColorShader(props.color));
  if (shader === undefined) return undefined;
  const cached = BUILDERS.get(props);
  if (cached) return cached;
  const builder = _material.fromShader(shader, props.textures ?? {});
  BUILDERS.set(props, builder);
  return builder;
};
