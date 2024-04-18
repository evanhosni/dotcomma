import { useEffect, useState } from "react";

enum KeyAction {
  KeyW = "forward",
  KeyS = "backward",
  KeyA = "left",
  KeyD = "right",
  ShiftLeft = "sprint",
  Space = "jump",
}

export const useInput = () => {
  const [input, setInput] = useState({
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    jump: false,
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
