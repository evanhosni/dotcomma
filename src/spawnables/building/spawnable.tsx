import { SpawnDescriptor, SpawnedObjectProps } from "../../objects/spawning/types";
import { Spawnable } from "../../world/components";
import { Building } from "./Building";

export const BuildingDescriptor: SpawnDescriptor = {
  id: "building",
  component: Building as React.FC<SpawnedObjectProps>,
  footprint: 30,
  // Buildings only place inside block interiors (off roads/sidewalks/ramps),
  // so density is set high to keep blocks packed — the footprint spacing is
  // the real limiter, letting buildings front right up against sidewalks.
  density: 3800,
  clustering: 0,
  renderDistance: 625,
  frustumPadding: 3.25,
  priority: 55,
  roadDistanceRange: [23, 99999],
};

/** Mounts the procedural building spawn registration; props override the
 *  descriptor. Restrict placement at the mount site, e.g.
 *  `<BuildingSpawnable biomeIds={[CITY_BIOME_ID]} />`.
 *
 *  Variants (apartment/office/theater/…) wrap <Building> with their own
 *  options, materials, and children, then register their own descriptor:
 *  `const Office = (p: SpawnedObjectProps) => <Building {...p} roomCount={12}>…</Building>`. */
export const BuildingSpawnable = (overrides: Partial<SpawnDescriptor>) => (
  <Spawnable {...BuildingDescriptor} {...overrides} />
);
