import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier";
import { GameObject } from "../objects/GameObject";
import { SpawnedObjectProps } from "../objects/spawning/types";
import { Portal } from "./Portal";
import { usePortalContext } from "./PortalContext";
import { allocateIndoorSlot, getIndoorY, releaseIndoorSlot } from "./indoorSlotAllocator";

interface PortalTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number]; // [width, height]
  geometry: THREE.BufferGeometry;
}

interface BuildingProps extends SpawnedObjectProps {
  exteriorModel: string;
  interiorModel: string;
  portals: string[];
  activationDistance?: number;
}

/**
 * Extract portal position, rotation, and size from a named plane object in a GLTF scene.
 * Door positions/normals are baked into the geometry vertices (not the node transform),
 * so we transform the bounding box by the node's matrixWorld and read normals from the
 * geometry NORMAL attribute.
 */
function extractPortalTransform(
  scene: THREE.Group,
  name: string,
): PortalTransform | null {
  const obj = scene.getObjectByName(name);
  if (!obj) return null;

  const mesh = obj as THREE.Mesh;
  if (!mesh.geometry) return null;

  scene.updateMatrixWorld(true);

  // Transform geometry bounding box into scene-local space via the node's matrixWorld
  // (scene root has identity transform, so matrixWorld = scene-local)
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);

  // Read face normal from geometry and transform to scene-local space
  const normal = new THREE.Vector3(0, 0, 1);
  const normalAttr = mesh.geometry.getAttribute("normal");
  if (normalAttr) {
    normal.set(normalAttr.getX(0), normalAttr.getY(0), normalAttr.getZ(0));
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    normal.applyMatrix3(normalMatrix).normalize();
  }

  // Compute Y rotation that maps portal local +Z to the face normal
  const yaw = Math.atan2(normal.x, normal.z);

  // Height is the Y extent. Width is the larger non-thin horizontal extent.
  const height = size.y;
  const THIN = 0.5;
  let width: number;
  if (size.x < THIN) {
    width = size.z;
  } else if (size.z < THIN) {
    width = size.x;
  } else {
    width = Math.max(size.x, size.z);
  }

  // Clone geometry and transform to Portal's local space:
  // mesh coords → scene-local → centered at origin → rotated to face +Z
  const geometry = mesh.geometry.clone();
  const toPortalLocal = new THREE.Matrix4()
    .makeRotationY(-yaw)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
    .multiply(mesh.matrixWorld);
  geometry.applyMatrix4(toPortalLocal);

  return {
    position: [center.x, center.y, center.z],
    rotation: [0, yaw, 0],
    size: [width, height],
    geometry,
  };
}

const EXTERIOR_COLOR = 0x707070;
const INTERIOR_COLOR = 0x999999;

function applyBuildingMaterial(root: THREE.Object3D, color: number, portalNames: Set<string>) {
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      if (portalNames.has(child.name)) {
        // Hide portal plane meshes — the Portal component renders its own visual
        child.visible = false;
      } else {
        (child as THREE.Mesh).material = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.85,
          metalness: 0.05,
        });
      }
    }
  });
}

const DEFAULT_ACTIVATION_DISTANCE = 50;

export const Building = ({
  id,
  coordinates,
  exteriorModel,
  interiorModel,
  portals: portalNames,
  activationDistance = DEFAULT_ACTIVATION_DISTANCE,
  renderDistance,
  onDestroy,
  scale,
  frustumPadding,
}: BuildingProps) => {
  const { activeIndoorId, playerRigidBodyRef } = usePortalContext();
  const { camera, gl, scene } = useThree();

  const [isNearby, setIsNearby] = useState(false);
  const nearbyRef = useRef(false);
  const positionRef = useRef(new THREE.Vector3(...coordinates));

  // Load both GLTFs (cached by useGLTF)
  const exteriorGltf = useGLTF(exteriorModel);
  const interiorGltf = useGLTF(interiorModel);

  // Apply default materials to models so they're visible
  const portalNameSet = useMemo(() => new Set(portalNames), [portalNames]);
  useMemo(() => applyBuildingMaterial(exteriorGltf.scene, EXTERIOR_COLOR, portalNameSet), [exteriorGltf.scene, portalNameSet]);

  // Uniform exterior scale factor (from descriptor scale prop)
  const extScale = scale ? scale[0] : 1;

  // Allocate a unique indoor Y slot
  const slotRef = useRef<number | null>(null);
  if (slotRef.current === null) {
    slotRef.current = allocateIndoorSlot();
  }
  const indoorY = getIndoorY(slotRef.current);

  useEffect(() => {
    return () => {
      if (slotRef.current !== null) {
        releaseIndoorSlot(slotRef.current);
      }
    };
  }, []);

  // Extract portal transforms from the original (uncloned) scenes
  const portalData = useMemo(() => {
    const data: { name: string; exterior: PortalTransform; interior: PortalTransform }[] = [];
    // Subdivide triangles larger than ~1/16 of the portal's smaller dimension.
    // Matches the old PlaneGeometry(w, h, 16, 16) subdivision density, which the
    // vertex shader relies on to smoothly clamp vertices around the camera's
    // near plane (otherwise the whole quad pops as the player steps through).
    const tessellateForPortal = (geom: THREE.BufferGeometry, w: number, h: number) => {
      const edge = Math.max(0.05, Math.min(w, h) / 16);
      const modifier = new TessellateModifier(edge, 6);
      return modifier.modify(geom);
    };
    for (const name of portalNames) {
      const ext = extractPortalTransform(exteriorGltf.scene, name);
      const int = extractPortalTransform(interiorGltf.scene, name);
      if (ext && int) {
        // Scale exterior geometry to match the building's scale
        if (extScale !== 1) {
          ext.geometry.scale(extScale, extScale, extScale);
        }
        const extW = ext.size[0] * extScale;
        const extH = ext.size[1] * extScale;
        ext.geometry = tessellateForPortal(ext.geometry, extW, extH);
        int.geometry = tessellateForPortal(int.geometry, int.size[0], int.size[1]);
        data.push({ name, exterior: ext, interior: int });
      }
    }
    return data;
  }, [exteriorGltf.scene, interiorGltf.scene, portalNames, extScale]);

  // Clone interior scene, apply material, and hide portal plane objects
  const interiorClone = useMemo(() => {
    const clone = interiorGltf.scene.clone(true);
    applyBuildingMaterial(clone, INTERIOR_COLOR, portalNameSet);
    for (const name of portalNames) {
      const obj = clone.getObjectByName(name);
      if (obj) obj.visible = false;
    }
    return clone;
  }, [interiorGltf.scene, portalNames, portalNameSet]);

  // Interior bounding box for colliders and lighting
  const interiorBounds = useMemo(() => {
    interiorClone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(interiorClone);
    const s = new THREE.Vector3();
    const c = new THREE.Vector3();
    box.getSize(s);
    box.getCenter(c);
    return { size: s, center: c };
  }, [interiorClone]);

  // Pre-compile interior materials against the FULL scene (not just the clone)
  // so the shader variant matches the actual light count at render time.
  // Compiling against just interiorClone (which has no lights as children) produces
  // a zero-light shader that gets recompiled lazily on first portal render — that
  // lazy recompilation is what caused the teleportation flash.
  useEffect(() => {
    // Give React one tick to add interiorClone + lights to the scene graph
    const id = requestAnimationFrame(() => {
      gl.compile(scene, camera);
    });
    return () => cancelAnimationFrame(id);
  }, [interiorClone, gl, camera, scene]);

  // Proximity check — runs before portal hooks (priority -2)
  useFrame(() => {
    const rb = playerRigidBodyRef.current;
    if (!rb) return;
    const rbPos = rb.translation();

    let minDist = Infinity;
    for (const pd of portalData) {
      // Exterior portal world position = coordinates + doorPos * extScale
      const px = coordinates[0] + pd.exterior.position[0] * extScale;
      const py = coordinates[1] + pd.exterior.position[1] * extScale;
      const pz = coordinates[2] + pd.exterior.position[2] * extScale;

      const bodyDist = Math.sqrt((rbPos.x - px) ** 2 + (rbPos.y - py) ** 2 + (rbPos.z - pz) ** 2);
      const camDist = Math.sqrt(
        (camera.position.x - px) ** 2 + (camera.position.y - py) ** 2 + (camera.position.z - pz) ** 2,
      );
      const dist = Math.min(bodyDist, camDist);
      if (dist < minDist) minDist = dist;
    }

    // Keep interior mounted while player is inside this building
    const isInside = activeIndoorId === id;
    const shouldBeNearby = minDist < activationDistance || isInside;

    if (shouldBeNearby !== nearbyRef.current) {
      nearbyRef.current = shouldBeNearby;
      setIsNearby(shouldBeNearby);
    }
  }, -2);

  return (
    <group position={coordinates}>
      {/* Exterior — always rendered via GameObject (fade, frustum cull, colliders) */}
      <GameObject
        model={exteriorModel}
        positionRef={positionRef}
        id={id}
        coordinates={coordinates}
        renderDistance={renderDistance}
        frustumPadding={frustumPadding}
        onDestroy={onDestroy}
        scale={scale}
        wholeTrimesh
        excludeColliderNames={portalNames}
      />

      {/* Enter portals — always rendered, scaled to match exterior */}
      {portalData.map((pd) => (
        <Portal
          key={`enter-${pd.name}`}
          id={`enter-${id}-${pd.name}`}
          pairedId={`exit-${id}-${pd.name}`}
          position={[
            pd.exterior.position[0] * extScale,
            pd.exterior.position[1] * extScale,
            pd.exterior.position[2] * extScale,
          ]}
          rotation={pd.exterior.rotation}
          size={[pd.exterior.size[0] * extScale, pd.exterior.size[1] * extScale]}
          geometry={pd.exterior.geometry}
          targetIndoorId={id}
          activationDistance={activationDistance}
          direction="enter"
        />
      ))}

      {/* Interior — always mounted and visible. At Y=10000+ it's frustum-culled from the
           main outdoor render, but the portal's virtual camera (at indoor Y) sees it. Keeping
           it always visible eliminates the 1-frame flash that occurred when the interior was
           invisible and the enter portal's virtual-camera render saw black. */}
      <group position={[0, indoorY - coordinates[1], 0]}>
        <primitive object={interiorClone} />
        <pointLight
          position={[interiorBounds.center.x, interiorBounds.size.y * 0.8, interiorBounds.center.z]}
          intensity={200}
          distance={Math.max(interiorBounds.size.x, interiorBounds.size.z) * 2}
        />
        <pointLight
          position={[interiorBounds.center.x, interiorBounds.center.y, interiorBounds.center.z]}
          intensity={80}
          distance={Math.max(interiorBounds.size.x, interiorBounds.size.z) * 2}
        />

        {/* Exit portals — interior positions used as-is (interior has its own scale) */}
        {portalData.map((pd) => (
          <Portal
            key={`exit-${pd.name}`}
            id={`exit-${id}-${pd.name}`}
            pairedId={`enter-${id}-${pd.name}`}
            position={pd.interior.position}
            rotation={pd.interior.rotation}
            size={pd.interior.size}
            geometry={pd.interior.geometry}
            targetIndoorId={id}
            activationDistance={activationDistance}
            direction="exit"
          />
        ))}

        {/* Interior colliders — only when player is inside (floor + ceiling only, no walls so portals aren't blocked) */}
        {activeIndoorId === id && (
          <RigidBody type="fixed" position={[interiorBounds.center.x, interiorBounds.center.y, interiorBounds.center.z]}>
            <CuboidCollider args={[interiorBounds.size.x / 2, 0.1, interiorBounds.size.z / 2]} position={[0, -interiorBounds.size.y / 2, 0]} />
            <CuboidCollider args={[interiorBounds.size.x / 2, 0.1, interiorBounds.size.z / 2]} position={[0, interiorBounds.size.y / 2, 0]} />
          </RigidBody>
        )}
      </group>
    </group>
  );
};
