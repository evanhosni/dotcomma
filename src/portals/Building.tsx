import { useGLTF } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GameObject } from "../objects/GameObject";
import { SpawnedObjectProps } from "../objects/spawning/types";
import { Portal } from "./Portal";
import { usePortalContext } from "./PortalContext";
import { allocateIndoorSlot, getIndoorY, releaseIndoorSlot } from "./indoorSlotAllocator";
import { getBuildingAssets } from "./portalAssets";

interface BuildingProps extends SpawnedObjectProps {
  exteriorModel: string;
  interiorModel: string;
  portals: string[];
  activationDistance?: number;
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
  const { activeIndoorId, publishIndoorBounds, unpublishIndoorBounds } = usePortalContext();

  const positionRef = useRef(new THREE.Vector3(...coordinates));
  const extScale = scale ? scale[0] : 1;

  // Load + cache GLTFs (shared across all Building instances of this type)
  const exteriorGltf = useGLTF(exteriorModel);
  const interiorGltf = useGLTF(interiorModel);

  // Cached per-type assets (portal geometry, interior template, bounds).
  // First call per (type, scale) does the work; subsequent buildings of the
  // same type get an O(1) lookup. This — plus the stable-light-count rig —
  // eliminates the spawn/despawn spike.
  const assets = useMemo(
    () =>
      getBuildingAssets(
        exteriorModel,
        interiorModel,
        exteriorGltf.scene,
        interiorGltf.scene,
        portalNames,
        extScale,
      ),
    [exteriorModel, interiorModel, exteriorGltf.scene, interiorGltf.scene, portalNames, extScale],
  );

  // Per-instance clone of the interior. Cheap because the template's
  // geometries and materials are shared refs — only the node hierarchy is
  // duplicated.
  const interiorClone = useMemo(() => assets.interiorTemplate.clone(true), [assets.interiorTemplate]);

  // Allocate a unique indoor Y slot for this building instance
  const slotRef = useRef<number | null>(null);
  if (slotRef.current === null) slotRef.current = allocateIndoorSlot();
  const indoorY = getIndoorY(slotRef.current);

  useEffect(() => {
    return () => {
      if (slotRef.current !== null) releaseIndoorSlot(slotRef.current);
    };
  }, []);

  // Publish world-space indoor bounds so IndoorLightRig can position the
  // global indoor lights when this building becomes the active indoor.
  useEffect(() => {
    const { size, center } = assets.interiorBounds;
    const worldCenter = new THREE.Vector3(
      coordinates[0] + center.x,
      indoorY + center.y,
      coordinates[2] + center.z,
    );
    publishIndoorBounds(id, { center: worldCenter, size: size.clone() });
    return () => unpublishIndoorBounds(id);
  }, [id, coordinates, indoorY, assets.interiorBounds, publishIndoorBounds, unpublishIndoorBounds]);

  const isInside = activeIndoorId === id;
  const { size: interiorSize, center: interiorCenter } = assets.interiorBounds;

  return (
    <group position={coordinates}>
      {/* Exterior — fades + frustum-culls via GameObject */}
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

      {/* Enter portals — outdoor-side doors, scaled to match the exterior */}
      {assets.portalData.map((pd) => (
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

      {/* Interior — always mounted. Lives at Y=indoorY so it's frustum-culled
          from the outdoor camera. Always-mounting is cheap now that materials
          and geometries are shared refs, and avoids the shader recompile that
          mount/unmount used to trigger via light-count churn. Lighting comes
          from the global IndoorLightRig. */}
      <group position={[0, indoorY - coordinates[1], 0]}>
        <primitive object={interiorClone} />

        {/* Exit portals — indoor-side doors */}
        {assets.portalData.map((pd) => (
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

        {/* Floor + ceiling colliders — only while the player is inside. No
             walls, so players can walk through the exit portal planes. */}
        {isInside && (
          <RigidBody type="fixed" position={[interiorCenter.x, interiorCenter.y, interiorCenter.z]}>
            <CuboidCollider
              args={[interiorSize.x / 2, 0.1, interiorSize.z / 2]}
              position={[0, -interiorSize.y / 2, 0]}
            />
            <CuboidCollider
              args={[interiorSize.x / 2, 0.1, interiorSize.z / 2]}
              position={[0, interiorSize.y / 2, 0]}
            />
          </RigidBody>
        )}
      </group>
    </group>
  );
};
