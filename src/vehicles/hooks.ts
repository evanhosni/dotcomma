import { useEffect, useRef } from "react";
import { clamp } from "../utils/math";
import { CHASE_PITCH, CHASE_PITCH_MAX, CHASE_PITCH_MIN, ORBIT_SENSITIVITY } from "./constants";
import type { ChaseCamera, DriveInput } from "./types";

/** `KeyboardEvent.code` → the held action. Arrows drive too. */
const DRIVE_KEYS: Readonly<Record<string, Exclude<keyof DriveInput, "exitPressed">>> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "backward",
  ArrowDown: "backward",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "handbrake",
};
/** GTA's "get in / get out". */
const EXIT_KEY = "KeyF";

/** The driving keys as a ref (never re-renders). */
export const useDriveInput = (): React.MutableRefObject<DriveInput> => {
  const input = useRef<DriveInput>({ forward: false, backward: false, left: false, right: false, handbrake: false, exitPressed: false });
  useEffect(() => {
    const onKey = (held: boolean) => (e: KeyboardEvent) => {
      if (e.code === EXIT_KEY && held && !e.repeat) input.current.exitPressed = true;
      const action = DRIVE_KEYS[e.code];
      if (action) input.current[action] = held;
    };
    const down = onKey(true);
    const up = onKey(false);
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
    };
  }, []);
  return input;
};

/** The chase camera's state, with the mouse orbiting it while the pointer is locked. */
export const useChaseCamera = (): ChaseCamera => {
  const chase = useRef<ChaseCamera>({ yaw: 0, orbitYaw: 0, orbitPitch: 0, lastMouse: -Infinity, distance: 0, placed: false }).current;
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!document.pointerLockElement || !chase.placed) return;
      chase.orbitYaw -= e.movementX * ORBIT_SENSITIVITY;
      chase.orbitPitch = clamp(chase.orbitPitch + e.movementY * ORBIT_SENSITIVITY, CHASE_PITCH_MIN - CHASE_PITCH, CHASE_PITCH_MAX - CHASE_PITCH);
      chase.lastMouse = performance.now();
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, [chase]);
  return chase;
};
