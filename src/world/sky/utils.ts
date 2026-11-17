import { childrenOfKind } from "../content";
import type { ContentNode } from "../content/types";
import type { SkyboxProps } from "./Skybox";
import type { SkyboxSettings, SkyboxRecord } from "./types";
import { SKYBOX_DEFAULTS } from "./defaults";

const settingsOf = (node: ContentNode<SkyboxProps>): SkyboxSettings => ({
  topColor: node.props.topColor ?? node.props.color ?? SKYBOX_DEFAULTS.topColor,
  horizonColor: node.props.horizonColor ?? node.props.color ?? SKYBOX_DEFAULTS.horizonColor,
  bottomColor: node.props.bottomColor ?? node.props.color ?? SKYBOX_DEFAULTS.bottomColor,
  radius: node.props.radius ?? SKYBOX_DEFAULTS.radius,
});

/** Every <Skybox> in a domain's tree, with the scope its place in the tree gives it. */
export const skyboxesOf = (domain: ContentNode<any>): SkyboxRecord[] => {
  const out: SkyboxRecord[] = [];
  for (const sky of childrenOfKind<SkyboxProps>(domain, "skybox")) out.push({ scope: "domain", ...settingsOf(sky) });
  for (const region of childrenOfKind<{ id: number }>(domain, "region")) {
    for (const sky of childrenOfKind<SkyboxProps>(region, "skybox")) out.push({ scope: "region", scopeId: region.props.id, ...settingsOf(sky) });
    for (const biome of childrenOfKind<{ id: number }>(region, "biome")) {
      for (const sky of childrenOfKind<SkyboxProps>(biome, "skybox")) out.push({ scope: "biome", scopeId: biome.props.id, ...settingsOf(sky) });
    }
  }
  return out;
};
