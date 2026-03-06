import { useEffect, useState } from "react";
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

const EMPTY_INPUT: InputState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
  jump: false,
  control: false,
};

export const useInput = (): InputState => {
  const { paletteOpen } = useUrlParameters();
  const [input, setInput] = useState<InputState>(EMPTY_INPUT);

  const findKey = (key: string): KeyAction | undefined => {
    return KeyAction[key as keyof typeof KeyAction];
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const action = findKey(e.code);
      if (action) {
        setInput((m) => ({ ...m, [action]: true }));
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const action = findKey(e.code);
      if (action) {
        setInput((m) => ({ ...m, [action]: false }));
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  if (paletteOpen) return EMPTY_INPUT;
  return input;
};
