import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { PortalDescriptor, usePortalContext } from "./PortalContext";
import { usePortalRenderer } from "./usePortalRenderer";

export interface PortalProps {
  id: string;
  pairedId: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  /** [width, height] of the door opening in world units */
  size: [number, number];
  /** Actual portal mesh geometry (matches the shape of the GLTF portal object) */
  geometry: THREE.BufferGeometry;
  targetIndoorId: string;
  activationDistance: number;
  /** "enter" = outdoor->indoor, "exit" = indoor->outdoor */
  direction: "enter" | "exit";
  /** URL path for indoor world navigation. Default "/" (no URL change). */
  urlPath?: string;
}

const _scale1 = new THREE.Vector3(1, 1, 1);
const _tmpScale = new THREE.Vector3();

export const Portal = ({
  id,
  pairedId,
  position,
  rotation,
  size,
  geometry,
  targetIndoorId,
  activationDistance,
  direction,
  urlPath,
}: PortalProps) => {
  const { registerPortal, unregisterPortal } = usePortalContext();
  const groupRef = useRef<THREE.Group>(null);
  const [width, height] = size;

  // Near-plane protection box: while the camera is within near-plane distance
  // of the door plane, the renderer swaps the door-shaped surface for this box
  // extruded through the plane away from the camera, so the near plane can
  // never clip a hole through the portal mid-crossing (the Valve/Portal
  // trick). At that range the doorway fills the screen, so the shape
  // difference is invisible.
  const boxGeometry = useMemo(() => new THREE.BoxGeometry(width, height, 1), [width, height]);
  useEffect(() => () => boxGeometry.dispose(), [boxGeometry]);

  // The descriptor object is created once and mutated in place each frame —
  // the registry, teleport system, and renderer all share this instance.
  const descriptorRef = useRef<PortalDescriptor | null>(null);
  if (!descriptorRef.current) {
    descriptorRef.current = {
      id,
      pairedId,
      direction,
      targetIndoorId,
      urlPath: urlPath ?? "/",
      activationDistance,
      halfWidth: width / 2,
      halfHeight: height / 2,
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      matrix: new THREE.Matrix4(),
      invMatrix: new THREE.Matrix4(),
      contextEnterId: null,
      activeMesh: null,
    };
  }

  useLayoutEffect(() => {
    registerPortal(descriptorRef.current!);
    return () => unregisterPortal(id);
  }, [id]); // registration is intentionally keyed on id only

  // Refresh the world transform every frame, BEFORE the teleport system (-2)
  // and renderer (1) read it. Measuring only once at mount is unreliable —
  // Buildings mount through Suspense (useGLTF) and the ancestor chain's world
  // matrices aren't guaranteed final at layout-effect time.
  useFrame(() => {
    const group = groupRef.current;
    const desc = descriptorRef.current;
    if (!group || !desc) return;
    group.updateWorldMatrix(true, false);
    // Portals are static in practice, so skip the decompose + inversion
    // unless the world matrix actually changed.
    const world = group.matrixWorld.elements;
    const cached = desc.matrix.elements;
    let changed = false;
    for (let i = 0; i < 16; i++) {
      if (world[i] !== cached[i]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    group.matrixWorld.decompose(desc.position, desc.quaternion, _tmpScale);
    desc.matrix.compose(desc.position, desc.quaternion, _scale1);
    desc.invMatrix.copy(desc.matrix).invert();
  }, -4);

  const { doorMeshRef, boxMeshRef, doorMaterial, boxMaterial } = usePortalRenderer({
    id,
    pairedId,
    size,
    activationDistance,
    direction,
  });

  const euler = rotation ? new THREE.Euler(...rotation) : undefined;

  return (
    <group ref={groupRef} position={position} rotation={euler}>
      {/* Both start invisible — the renderer picks one per frame (black at
          distance, live view in range, protection box while crossing). */}
      <mesh ref={doorMeshRef} geometry={geometry} visible={false}>
        <primitive object={doorMaterial} attach="material" />
      </mesh>
      <mesh ref={boxMeshRef} geometry={boxGeometry} visible={false}>
        <primitive object={boxMaterial} attach="material" />
      </mesh>
    </group>
  );
};
