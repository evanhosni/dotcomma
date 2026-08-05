import { SpawnDescriptor, SpawnedObjectProps } from "../../objects/spawning/types";
import { Spawnable } from "../../world/components";
import { Building } from "./Building";

export const BuildingDescriptor: SpawnDescriptor = {
  id: "building",
  component: Building as React.FC<SpawnedObjectProps>,
  footprint: 30,
  density: 500,
  clustering: 0,
  renderDistance: 625,
  frustumPadding: 3.25,
  priority: 55,
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
