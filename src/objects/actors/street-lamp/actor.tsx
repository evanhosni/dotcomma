import { ActorDescriptor } from "../../spawning/types";
import { createActor } from "../../../world/components";
import { StreetLamp } from "./StreetLamp";

export const StreetLampDescriptor: ActorDescriptor = {
  id: "street-lamp",
  component: StreetLamp,
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

export const StreetLampActor = createActor(StreetLampDescriptor);
