import type React from "react";
import { Building } from "./building/Building";
import { ModelActor } from "./ModelActor";
import type { ActorComponentName } from "./spec";

/** The client members an ActorSpec's `component` names. A new member (an actor that owns its
 *  geometry, like Building) is one entry here plus the name in ActorComponentName. */
export const ACTOR_COMPONENTS: Record<ActorComponentName, React.FC<any>> = {
  model: ModelActor,
  building: Building,
};
