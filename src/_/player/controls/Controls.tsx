import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";

const useInput = () => {
  const [input, setInput] = useState({
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    jump: false,
  });

  const keys = {
    KeyW: "forward",
    KeyS: "backward",
    KeyA: "left",
    KeyD: "right",
    ShiftLeft: "sprint",
    Space: "jump",
  };

  const findKey = (key: string) => keys[key as keyof typeof keys];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      setInput((m) => ({ ...m, [findKey(e.code)]: true }));
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      setInput((m) => ({ ...m, [findKey(e.code)]: false }));
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

export const Controls = () => {
  const { forward, backward, left, right, sprint, jump } = useInput();

  const camera = useThree((state) => state.camera);

  // useEffect(() => {
  //   forward && console.log("forward", forward);
  //   backward && console.log("backward", backward);
  //   left && console.log("left", left);
  //   right && console.log("right", right);
  //   sprint && console.log("sprint", sprint);
  //   jump && console.log("jump", jump);
  // }, [forward, backward, left, right, sprint, jump]);

  const tempSpeeeeed = 5;

  useFrame((state, delta) => {
    if (forward) {
      camera.position.z -= 0.1 * tempSpeeeeed;
    }
    if (backward) {
      camera.position.z += 0.1 * tempSpeeeeed;
    }
    if (left) {
      camera.position.x -= 0.1 * tempSpeeeeed;
    }
    if (right) {
      camera.position.x += 0.1 * tempSpeeeeed;
    }
    if (jump) {
      camera.position.y += 0.1;
    }
    if (sprint) {
      camera.position.y -= 0.1;
    }
  });

  return <PointerLockControls />;
};
