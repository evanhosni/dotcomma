import { useEffect, useState } from "react";

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

export const useInput = (): InputState => {
  const [input, setInput] = useState<InputState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    jump: false,
    control: false,
  });

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

  return input;
};
