import { RootState } from "@react-three/fiber";
import { useCallback, useRef } from "react";
import * as THREE from "three";
import { ModelActor, ModelActorAttributes } from "../ModelActor";
import { ActorFrameContext } from "../Actor";
import { ActorProps } from "../spawning/types";
import { useMouseEvents } from "../state/useMouseEvents";
import { useStateMachine } from "../state/useStateMachine";
import { framePhaseFromCoords } from "../../../utils/utils";
import { BEEBLE_SM } from "./stateMachine";

const HAS_CLICK_TRIGGER = BEEBLE_SM.triggers.some((t) => t.id === "mouse-left-click");
const MOUSE_THROTTLE_FRAMES = 3;

/** The beeble NPC: a state machine (wander, notice the player, ascend on
 *  click) and its mouse events, both ticked from the ONE frame callback the
 *  actor base hands us. The body (capsule, gravity, slopes) and everything
 *  about multiplayer — who simulates this beeble, publishing its pose and
 *  clip, puppeting it on other clients — belong to ModelActor and the actor
 *  base. This component only says how fast it wants to move (`ctx.move`),
 *  which the state machine already decides. */
export const Beeble = (props: ActorProps<ModelActorAttributes>) => {
  const groupRef = useRef<THREE.Group>(null);
  // Body CENTER, written by ModelActor's mover; the state machine reads it.
  const positionRef = useRef<THREE.Vector3>(new THREE.Vector3(...props.coordinates));
  const framePhase = useRef(
    framePhaseFromCoords(props.coordinates[0], props.coordinates[2], MOUSE_THROTTLE_FRAMES),
  ).current;

  const sm = useStateMachine(BEEBLE_SM, positionRef, groupRef, { externallyDriven: true });
  // Mouse interaction is fully handled inside useMouseEvents (window
  // listeners + a manual screen-center raycast) — nothing is attached to the
  // R3F group, see the note at the end of useMouseEvents.
  const mouse = useMouseEvents(sm, groupRef, {
    shouldGrowCursor: props.cursorOverride ?? HAS_CLICK_TRIGGER,
    framePhase,
    externallyDriven: true,
  });

  const onFrame = useCallback(
    (state: RootState, delta: number, ctx: ActorFrameContext) => {
      sm.tick(state, Math.min(delta, 0.1));
      mouse.tick(state.camera, ctx.distanceSq);
      // The state machine's velocity blackboard → this frame's move intent.
      const bb = sm.blackboard;
      if (ctx.move) {
        ctx.move.vx = bb.__vel_x ?? 0;
        ctx.move.vz = bb.__vel_z ?? 0;
        ctx.move.vy = bb.__vel_y ?? null;
      }
    },
    [sm, mouse],
  );

  return (
    <ModelActor
      {...props}
      groupRef={groupRef}
      positionRef={positionRef}
      animationControl={sm.animationControl}
      scale={[1.2, 1.2, 1.2]}
      onFrame={onFrame}
    />
  );
};
