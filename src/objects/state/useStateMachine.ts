import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import {
  AnimationControl,
  BehaviorContext,
  StateDef,
  StateMachineConfig,
  StateMachineHandle,
  TriggerContext,
  TriggerDef,
} from "./types";

const _playerDiff = new THREE.Vector3();

export function useStateMachine(
  config: StateMachineConfig,
  positionRef: React.MutableRefObject<THREE.Vector3>,
  groupRef: React.MutableRefObject<THREE.Group | null>
): StateMachineHandle {
  const { playerPosition } = useGameContext();

  const stateMap = useMemo(() => {
    const map = new Map<string, StateDef>();
    for (const s of config.states) map.set(s.id, s);
    return map;
  }, [config.states]);

  const triggerMap = useMemo(() => {
    const map = new Map<string, TriggerDef>();
    for (const t of config.triggers) map.set(t.id, t);
    return map;
  }, [config.triggers]);

  const currentStateIdRef = useRef(config.initialState);
  const stateEnteredAtRef = useRef(0);
  const exitCleanupRef = useRef<(() => void) | null>(null);
  const blackboardRef = useRef<Record<string, any>>({});
  const initialEnterDone = useRef(false);

  const animationControlRef = useRef<AnimationControl>({
    pendingCommand: null,
    dirty: false,
  });

  const enterState = useCallback(
    (stateId: string, elapsed: number, ctx: BehaviorContext) => {
      if (exitCleanupRef.current) {
        exitCleanupRef.current();
        exitCleanupRef.current = null;
      }

      const state = stateMap.get(stateId);
      if (!state) return;

      currentStateIdRef.current = stateId;
      stateEnteredAtRef.current = elapsed;

      if (state.animation) {
        animationControlRef.current.pendingCommand = state.animation;
        animationControlRef.current.dirty = true;
      }

      if (state.onEnter) {
        const cleanup = state.onEnter(ctx);
        if (typeof cleanup === "function") {
          exitCleanupRef.current = cleanup;
        }
      }
    },
    [stateMap]
  );

  useFrame((threeState, delta) => {
    const elapsed = threeState.clock.elapsedTime;

    _playerDiff.subVectors(playerPosition, positionRef.current);
    const playerDistanceSq =
      _playerDiff.x * _playerDiff.x + _playerDiff.z * _playerDiff.z;

    const triggerCtx: TriggerContext = {
      positionRef,
      playerPosition,
      playerDistanceSq,
      delta,
      elapsed,
      blackboard: blackboardRef.current,
      stateElapsed: elapsed - stateEnteredAtRef.current,
    };

    const behaviorCtx: BehaviorContext = {
      ...triggerCtx,
      groupRef,
    };

    // Enter initial state on first frame
    if (!initialEnterDone.current) {
      initialEnterDone.current = true;
      enterState(config.initialState, elapsed, behaviorCtx);
    }

    // Check for forced transition
    const forcedTarget = blackboardRef.current.__forcedTransition;
    if (forcedTarget) {
      delete blackboardRef.current.__forcedTransition;
      enterState(forcedTarget, elapsed, behaviorCtx);
      const newState = stateMap.get(currentStateIdRef.current);
      if (newState?.onUpdate) {
        newState.onUpdate(behaviorCtx);
      }
      return;
    }

    const currentState = stateMap.get(currentStateIdRef.current);
    if (!currentState) return;

    // Evaluate transitions — first match wins
    for (const transition of currentState.transitions) {
      const trigger = triggerMap.get(transition.trigger);
      if (!trigger) continue;

      if (trigger.evaluate(triggerCtx)) {
        if (transition.guard && !transition.guard(triggerCtx)) continue;

        enterState(transition.target, elapsed, behaviorCtx);
        const newState = stateMap.get(currentStateIdRef.current);
        if (newState?.onUpdate) {
          newState.onUpdate(behaviorCtx);
        }
        return;
      }
    }

    // No transition — run current behavior
    if (currentState.onUpdate) {
      currentState.onUpdate(behaviorCtx);
    }

    // Clear one-shot mouse event flags
    const bb = blackboardRef.current;
    for (const key in bb) {
      if (key.startsWith("__mouse_") && key !== "__mouse_hover_active") {
        delete bb[key];
      }
    }
  });

  useEffect(() => {
    return () => {
      if (exitCleanupRef.current) {
        exitCleanupRef.current();
        exitCleanupRef.current = null;
      }
    };
  }, []);

  const handle = useMemo<StateMachineHandle>(
    () => ({
      get currentStateId() {
        return currentStateIdRef.current;
      },
      forceTransition: (stateId: string) => {
        blackboardRef.current.__forcedTransition = stateId;
      },
      blackboard: blackboardRef.current,
      animationControl: animationControlRef.current,
    }),
    []
  );

  return handle;
}
