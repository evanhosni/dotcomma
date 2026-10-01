import type React from "react";
import { HomeDomain } from "./home/domain";
import { OverworldDomain } from "./overworld/domain";
import type { DomainId } from "./types";

/** The component index.tsx mounts for each domain (inside the ONE persistent canvas). */
export const DOMAIN_COMPONENTS: Record<DomainId, React.ComponentType> = {
  home: HomeDomain,
  overworld: OverworldDomain,
};
