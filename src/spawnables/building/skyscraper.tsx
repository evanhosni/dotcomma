import { SpawnDescriptor, SpawnedObjectProps } from "../../objects/spawning/types";
import { Spawnable } from "../../world/components";
import { Building } from "./Building";

/** Skyscraper variant: max floors under a much taller shell (the mass above
 *  the top floor reads as mechanical levels), with a gentler lean so tall
 *  neighbors don't collide. */
export const Skyscraper = (props: SpawnedObjectProps) => (
  <Building {...props} stories={6} roomCount={[3, 4, 5, 6]} heightRange={[70, 115]} maxLean={0.04} />
);

export const SkyscraperDescriptor: SpawnDescriptor = {
  id: "skyscraper",
  component: Skyscraper,
  footprint: 36,
  density: 30,
  clustering: 0,
  renderDistance: 625,
  frustumPadding: 3.25,
  priority: 45,
};

/** Mounts the skyscraper spawn registration; props override the descriptor. */
export const SkyscraperSpawnable = (overrides: Partial<SpawnDescriptor>) => (
  <Spawnable {...SkyscraperDescriptor} {...overrides} />
);
