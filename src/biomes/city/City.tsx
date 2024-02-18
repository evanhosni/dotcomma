import { useBox } from "@react-three/cannon";
import { Biome } from "../../types/Biome";
import { getMaterial } from "./props/getMaterial";
import { getVertexData } from "./props/getVertexData";

export const CityProperties: Biome = {
  name: "city",
  getVertexData: getVertexData,
  getMaterial: getMaterial,
};

// Slightly Rotated Cube component using useBox hook
const SkyCube = () => {
  const [ref, api] = useBox(() => ({
    mass: 1, // Assign some mass to the cube so that it's affected by gravity
    position: [10, 50, -20], // Position the cube
    rotation: [0.1, 0.1, 0.1], // Slightly rotate the cube for visual effect
    args: [10, 10, 10], // Make sure this matches the boxGeometry dimensions
    friction: 0.7, // Adjust the friction to make it more or less slidey
    restitution: 0.3, // Adjust restitution for bounciness
    linearDamping: 0.1, // Apply some damping to reduce linear velocity over time
    angularDamping: 0.1, // Apply some damping to reduce rotation velocity over time
    allowSleep: true, // Allow the cube to go to sleep (deactivate)
    sleepSpeedLimit: 0.1, // The velocity below which the cube can go to sleep
    sleepTimeLimit: 1, // Time in seconds after which the cube is allowed to go to sleep
  }));

  return (
    <mesh ref={ref as any}>
      <boxGeometry attach="geometry" args={[10, 10, 10]} /> {/* Define the size of the cube */}
      <meshStandardMaterial attach="material" color="blue" /> {/* Adjust the color/material as needed */}
    </mesh>
  );
};

export const City = () => {
  return <></>;
};
