import { useEffect, useRef } from "react";

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  jump: boolean;
  /** Descend in noclip. */
  control: boolean;
}

/** `KeyboardEvent.code` → the action it holds. */
const KEY_BINDINGS: Readonly<Record<string, keyof InputState>> = {
  KeyW: "forward",
  KeyS: "backward",
  KeyA: "left",
  KeyD: "right",
  ShiftLeft: "sprint",
  Space: "jump",
  ControlLeft: "control",
  ControlRight: "control",
};

/** A ref of the actions currently held, updated from document key events (never re-renders). */
export const useInput = (): React.MutableRefObject<InputState> => {
  const inputRef = useRef<InputState>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    jump: false,
    control: false,
  });

  useEffect(() => {
    const setHeld = (code: string, held: boolean) => {
      const action = KEY_BINDINGS[code];
      if (action) inputRef.current[action] = held;
    };
    const handleKeyDown = (e: KeyboardEvent) => setHeld(e.code, true);
    const handleKeyUp = (e: KeyboardEvent) => setHeld(e.code, false);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  return inputRef;
};
