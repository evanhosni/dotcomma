import { SpawnDescriptor } from "../../objects/spawning/types";
import { Spawnable } from "../../world/components";
import { StreetLight } from "./StreetLight";

export const StreetLightDescriptor: SpawnDescriptor = {
  id: "street-light",
  component: StreetLight,
  footprint: 14, // also the min spacing between lamps along a sidewalk
  // Lamps only place on the sidewalk band beside roads (roadDistanceRange),
  // a thin strip — density is set very high so lamps line every street.
  density: 4200,
  clustering: 0,
  renderDistance: 440,
  frustumPadding: 3,
  priority: 65,
  roadDistanceRange: [8.2, 11.8],
};

/** Mounts the street light spawn registration; props override the descriptor.
 *  Restrict placement at the mount site, e.g.
 *  `<StreetLightSpawnable biomeIds={[CITY_BIOME_ID]} />`. */
export const StreetLightSpawnable = (overrides: Partial<SpawnDescriptor>) => (
  <Spawnable {...StreetLightDescriptor} {...overrides} />
);
