import { declare } from "../content";

export interface SkyboxProps {
  /** One color for the whole sky: the default of the three below. */
  color?: string;
  topColor?: string;
  horizonColor?: string;
  bottomColor?: string;
  /** Sky sphere radius — only the domain-level skybox's radius is used. */
  radius?: number;
}

/** The SKY of whatever it is mounted in: under <Domain> the default, under a <Region> that
 *  region's — MIXED by position across region edges, so the sky never snaps at one — and under a
 *  <Biome> one that wins while the player stands in it. SkyboxSystem cross-fades between them. */
export const Skybox = declare<SkyboxProps>({ kind: "skybox", within: ["domain", "region", "biome"] });
