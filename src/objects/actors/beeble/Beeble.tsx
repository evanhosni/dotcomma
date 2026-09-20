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

// Body, physics and multiplayer belong to ModelActor and the actor base; this
// only turns the state machine's velocity into the frame's move intent.
export const Beeble = (props: ActorProps<ModelActorAttributes>) => {
  const groupRef = useRef<THREE.Group>(null);
  const positionRef = useRef<THREE.Vector3>(new THREE.Vector3(...props.coordinates));
  const framePhase = useRef(
    framePhaseFromCoords(props.coordinates[0], props.coordinates[2], MOUSE_THROTTLE_FRAMES),
  ).current;

  const sm = useStateMachine(BEEBLE_SM, positionRef, groupRef, { externallyDriven: true });
  const mouse = useMouseEvents(sm, groupRef, {
    shouldGrowCursor: props.cursorOverride ?? HAS_CLICK_TRIGGER,
    framePhase,
    externallyDriven: true,
  });

  const onFrame = useCallback(
    (state: RootState, delta: number, ctx: ActorFrameContext) => {
      sm.tick(state, Math.min(delta, 0.1));
      mouse.tick(state.camera, ctx.distanceSq);
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
