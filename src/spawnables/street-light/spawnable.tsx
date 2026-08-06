import { SpawnDescriptor } from "../../objects/spawning/types";
import { Spawnable } from "../../world/components";
import { StreetLight } from "./StreetLight";

export const StreetLightDescriptor: SpawnDescriptor = {
  id: "street-light",
  component: StreetLight,
  footprint: 2,
  density: 900, // high — lamps everywhere in the city
  clustering: 0,
  renderDistance: 440,
  frustumPadding: 3,
  priority: 65,
};

/** Mounts the street light spawn registration; props override the descriptor.
 *  Restrict placement at the mount site, e.g.
 *  `<StreetLightSpawnable biomeIds={[CITY_BIOME_ID]} />`. */
export const StreetLightSpawnable = (overrides: Partial<SpawnDescriptor>) => (
  <Spawnable {...StreetLightDescriptor} {...overrides} />
);
