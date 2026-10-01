import type React from "react";
import { Building } from "./building/Building";
import { ModelActor } from "./ModelActor";
import type { ActorWarmupHooks } from "./spawning/types";
import type { ActorComponentName } from "./spec";

/** The client members an ActorSpec's `component` names. A new member (an actor that owns its
 *  geometry, like Building) is one entry here plus the name in ActorComponentName. */
export const ACTOR_COMPONENTS: Record<ActorComponentName, React.FC<any> & ActorWarmupHooks> = {
  model: ModelActor,
  building: Building,
};

// A member without a load-time warm-up links its programs in the frame its first instance streams in.
if (process.env.NODE_ENV !== "production") {
  for (const [name, component] of Object.entries(ACTOR_COMPONENTS)) {
    if (component.Warmup) continue;
    console.error(
      `[actors] ACTOR_COMPONENTS.${name} has no static \`Warmup\` (spawning/types.ts ActorWarmupHooks), so its programs ` +
        `link mid-play. A wrapper of ModelActor reuses its warm-up through withModelActorWarmup(Wrapper) (ModelActor.tsx).`,
    );
  }
}
