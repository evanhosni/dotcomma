import { FREEWAY_LAMPS, FREEWAY_LAMPS_SPEC } from "./spec";
import { declare } from "../../../world/content";
import type { SolidDressingProps } from "../types";
import { LampPosts } from "./LampPosts";

/** LAMPS along both sides of every inter-city freeway run leaving the biome this is mounted in —
 *  the runs are its infrastructure, and they cross open country between cities. */
export const FreewayLamps = declare<SolidDressingProps>({
  kind: FREEWAY_LAMPS,
  within: "biome",
  read: (node) => ({ ...node.props }),
  Driver: () => <LampPosts spec={FREEWAY_LAMPS_SPEC} kind={FREEWAY_LAMPS} />,
});
