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
  TriggerDef,
} from "./types";

const _playerDiff = new THREE.Vector3();

// One-shot mouse flags written by useMouseEvents — the FIXED set of flag keys
// from src/objects/state/triggers.ts. Cleared by resetting to false each
// frame (truthiness-identical to the old delete, but `delete` forced the
// blackboard into dictionary mode). `__mouse_hover_active` is deliberately
// absent: it is level-triggered and persists across frames.
const MOUSE_ONE_SHOT_FLAGS = [
  "__mouse_hover_enter",
  "__mouse_hover_leave",
  "__mouse_left_click",
  "__mouse_right_click",
  "__mouse_left_click_down",
  "__mouse_right_click_down",
  "__mouse_left_click_up",
  "__mouse_right_click_up",
  "__mouse_scroll",
  "__mouse_scroll_up",
  "__mouse_scroll_down",
  "__mouse_double_click",
  "__mouse_middle_click",
] as const;

// State/trigger lookup maps are pure functions of the (module-constant)
// config — build them once per config, not once per actor instance.
const configMapsCache = new WeakMap<
  StateMachineConfig,
  { stateMap: Map<string, StateDef>; triggerMap: Map<string, TriggerDef> }
>();

const getConfigMaps = (config: StateMachineConfig) => {
  let maps = configMapsCache.get(config);
  if (!maps) {
    const stateMap = new Map<string, StateDef>();
    for (const s of config.states) stateMap.set(s.id, s);
    const triggerMap = new Map<string, TriggerDef>();
    for (const t of config.triggers) triggerMap.set(t.id, t);
    maps = { stateMap, triggerMap };
    configMapsCache.set(config, maps);
  }
  return maps;
};

export function useStateMachine(
  config: StateMachineConfig,
  positionRef: React.MutableRefObject<THREE.Vector3>,
  groupRef: React.MutableRefObject<THREE.Group | null>
): StateMachineHandle {
  const { playerPosition } = useGameContext();

  const { stateMap, triggerMap } = getConfigMaps(config);

  const currentStateIdRef = useRef(config.initialState);
  const stateEnteredAtRef = useRef(0);
  const exitCleanupRef = useRef<(() => void) | null>(null);
  const blackboardRef = useRef<Record<string, any>>({});
  const initialEnterDone = useRef(false);

  const animationControlRef = useRef<AnimationControl>({
    pendingCommand: null,
    dirty: false,
  });

  // ONE context object per instance, fields mutated per frame — allocating a
  // fresh triggerCtx + spread behaviorCtx per actor per frame was measurable
  // GC churn. BehaviorContext extends TriggerContext, so the same object is
  // passed to triggers and behaviors alike (groupRef is set at creation).
  const ctxRef = useRef<BehaviorContext | null>(null);
  if (!ctxRef.current) {
    ctxRef.current = {
      positionRef,
      playerPosition,
      playerDistanceSq: 0,
      delta: 0,
      elapsed: 0,
      stateElapsed: 0,
      blackboard: blackboardRef.current,
      groupRef,
    };
  }

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

    // Mutate the per-instance context in place (see ctxRef above)
    const behaviorCtx = ctxRef.current!;
    behaviorCtx.playerPosition = playerPosition;
    behaviorCtx.playerDistanceSq = playerDistanceSq;
    behaviorCtx.delta = delta;
    behaviorCtx.elapsed = elapsed;
    behaviorCtx.stateElapsed = elapsed - stateEnteredAtRef.current;
    const triggerCtx = behaviorCtx;

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

    // Clear one-shot mouse event flags — fixed key set reset to false (the
    // old for...in + delete forced the blackboard into dictionary mode)
    const bb = blackboardRef.current;
    for (let i = 0; i < MOUSE_ONE_SHOT_FLAGS.length; i++) {
      bb[MOUSE_ONE_SHOT_FLAGS[i]] = false;
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
