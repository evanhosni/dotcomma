import { SpawnedObjectProps } from "../../../../objects/spawning/types";
import { Building } from "../../../../portals/Building";

export const Building1 = (props: SpawnedObjectProps) => (
  <Building
    {...props}
    exteriorModel="/models/building1exterior.glb"
    interiorModel="/models/building1interior.glb"
    portals={["door1", "door2"]}
  />
);
