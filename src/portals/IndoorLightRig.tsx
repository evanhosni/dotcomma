import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { usePortalContext } from "./PortalContext";

/**
 * Global indoor light rig — always-mounted, fixed-count point lights shared
 * across every indoor space.
 *
 * Three.js `MeshStandardMaterial` keys its compiled shader variant on the
 * scene's light count. Before this component, every Building mounted two of
 * its own `<pointLight>` elements, so each spawn/despawn flipped the scene
 * light count — forcing a full shader recompile for *every* material in the
 * scene (terrain, sky, city, spawns). That was the dominant spawn lag spike.
 *
 * Declaring a fixed set of lights once at the app level keeps the count
 * stable from first frame onward, so shaders compile exactly once. When an
 * indoor is active, the lights are positioned at that indoor's world-space
 * bounds. When no indoor is active, they park far below the world with zero
 * intensity — still present in the scene (variant count stable) but
 * invisible in the render.
 */

const PARK_Y = -1e6;

export const IndoorLightRig = () => {
  const { activeIndoorId, getIndoorBounds } = usePortalContext();
  const ceilingLightRef = useRef<THREE.PointLight>(null);
  const fillLightRef = useRef<THREE.PointLight>(null);

  useFrame(() => {
    const ceiling = ceilingLightRef.current;
    const fill = fillLightRef.current;
    if (!ceiling || !fill) return;

    const bounds = activeIndoorId ? getIndoorBounds(activeIndoorId) : null;
    if (!bounds) {
      ceiling.position.set(0, PARK_Y, 0);
      fill.position.set(0, PARK_Y, 0);
      ceiling.intensity = 0;
      fill.intensity = 0;
      return;
    }

    const { center, size } = bounds;
    const maxHoriz = Math.max(size.x, size.z);
    ceiling.position.set(center.x, center.y + size.y * 0.3, center.z);
    ceiling.intensity = 200;
    ceiling.distance = maxHoriz * 2;
    fill.position.set(center.x, center.y, center.z);
    fill.intensity = 80;
    fill.distance = maxHoriz * 2;
  });

  return (
    <>
      <pointLight ref={ceilingLightRef} position={[0, PARK_Y, 0]} intensity={0} distance={1} />
      <pointLight ref={fillLightRef} position={[0, PARK_Y, 0]} intensity={0} distance={1} />
    </>
  );
};
