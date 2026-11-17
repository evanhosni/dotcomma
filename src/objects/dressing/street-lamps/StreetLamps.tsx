import { STREET_LAMPS, STREET_LAMPS_SPEC } from "./spec";
import { declare } from "../../../world/content";
import type { SolidDressingProps } from "../types";
import { LampPosts } from "./LampPosts";

/** LAMPS along the sidewalks of the biome this is mounted in (density-placed on its road field's
 *  sidewalk band). One driver draws every mount: chunks are world-space. */
export const StreetLamps = declare<SolidDressingProps>({
  kind: STREET_LAMPS,
  within: "biome",
  read: (node) => ({ ...node.props }),
  Driver: () => <LampPosts spec={STREET_LAMPS_SPEC} kind={STREET_LAMPS} />,
});
