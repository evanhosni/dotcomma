import { useEffect, useRef } from "react";
import { useUrlParameters } from "../context/UrlParametersContext";

enum KeyAction {
  KeyW = "forward",
  KeyS = "backward",
  KeyA = "left",
  KeyD = "right",
  ShiftLeft = "sprint",
  Space = "jump",
  ControlLeft = "control",
  ControlRight = "control",
}

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  jump: boolean;
  control: boolean;
}

export const useInput = (): React.MutableRefObject<InputState> => {
  const { paletteOpen } = useUrlParameters();
  const inputRef = useRef<InputState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    jump: false,
    control: false,
  });
  const paletteOpenRef = useRef(paletteOpen);
  paletteOpenRef.current = paletteOpen;

  // Clear all input when palette opens
  useEffect(() => {
    if (paletteOpen) {
      const input = inputRef.current;
      input.forward = false;
      input.backward = false;
      input.left = false;
      input.right = false;
      input.sprint = false;
      input.jump = false;
      input.control = false;
    }
  }, [paletteOpen]);

  useEffect(() => {
    const findKey = (key: string): KeyAction | undefined => {
      return KeyAction[key as keyof typeof KeyAction];
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (paletteOpenRef.current) return;
      const action = findKey(e.code);
      if (action) {
        (inputRef.current as any)[action] = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const action = findKey(e.code);
      if (action) {
        (inputRef.current as any)[action] = false;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  return inputRef;
};
