import { useThree } from "@react-three/fiber";
import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

export const OBJECT_DELETE_DISTANCE = 2500 + 250;
const COMPONENT_LOAD_DISTANCE = 2500; //TODO make this object dependent so buildings can render further

interface ObjectPoolEntry {
  component: React.FC<any>;
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  active: boolean;
  id: string;
  isPlaceholder: boolean;
}

const objectPools: { [key: string]: ObjectPoolEntry[] } = {};

const getObjectPool = (componentType: string): ObjectPoolEntry[] => {
  if (!objectPools[componentType]) {
    objectPools[componentType] = [];
  }
  return objectPools[componentType];
};

const getObjectFromPool = (componentType: string, component: React.FC<any>): ObjectPoolEntry | null => {
  const pool = getObjectPool(componentType);
  const inactiveObject = pool.find((entry) => !entry.active);

  if (inactiveObject) {
    inactiveObject.active = true;
    inactiveObject.isPlaceholder = true;
    return inactiveObject;
  }

  const newObject: ObjectPoolEntry = {
    component,
    coordinates: [0, 0, 0],
    active: true,
    id: `${componentType}_${pool.length}`,
    isPlaceholder: true,
  };
  pool.push(newObject);
  return newObject;
};

export const spawnObject = ({
  component,
  coordinates,
  scale,
  rotation,
}: {
  component: React.FC<any>;
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
}) => {
  const componentType = component.displayName || component.name;
  if (!componentType) {
    console.error("Component must have a displayName or name property.");
    return;
  }

  const poolEntry = getObjectFromPool(componentType, component);

  if (poolEntry) {
    poolEntry.coordinates = coordinates;
    poolEntry.scale = scale;
    poolEntry.rotation = rotation;
  }
};

const PlaceholderWrapper: React.FC<{
  isPlaceholder: boolean;
  coordinates: THREE.Vector3Tuple;
  children: React.ReactNode;
}> = ({ isPlaceholder, coordinates, children }) => {
  if (isPlaceholder) {
    return (
      <mesh position={coordinates}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="gray" opacity={0.5} />
      </mesh>
    );
  }
  return <>{children}</>;
};

export const ObjectPoolManager = () => {
  const [activeObjectIds, setActiveObjectIds] = useState<Set<string>>(new Set());
  const { camera } = useThree();
  const sceneObjectsRef = useRef<Map<string, ObjectPoolEntry>>(new Map());

  const updateRenderedObjects = useCallback(() => {
    const allObjects = Object.values(objectPools).flat();
    const newActiveObjectIds = new Set<string>();
    const thresholdSquared = OBJECT_DELETE_DISTANCE * OBJECT_DELETE_DISTANCE;
    const loadThresholdSquared = COMPONENT_LOAD_DISTANCE * COMPONENT_LOAD_DISTANCE;

    allObjects.forEach((entry) => {
      if (entry.active) {
        const objectPosition = new THREE.Vector3(...entry.coordinates);
        const distanceSquared = camera.position.distanceToSquared(objectPosition);

        if (distanceSquared > thresholdSquared) {
          entry.active = false;
          entry.isPlaceholder = true;
          if (sceneObjectsRef.current.has(entry.id)) {
            sceneObjectsRef.current.delete(entry.id);
          }
        } else {
          newActiveObjectIds.add(entry.id);

          if (distanceSquared <= loadThresholdSquared && entry.isPlaceholder) {
            entry.isPlaceholder = false;
          } else if (distanceSquared > loadThresholdSquared && !entry.isPlaceholder) {
            entry.isPlaceholder = true;
          }
        }
      }
    });
    setActiveObjectIds(newActiveObjectIds);
  }, [camera.position]);

  useEffect(() => {
    const interval = setInterval(updateRenderedObjects, 1000 / 30);
    return () => clearInterval(interval);
  }, [updateRenderedObjects]);

  return (
    <>
      {Array.from(activeObjectIds).map((id) => {
        const entry = Object.values(objectPools)
          .flat()
          .find((e) => e.id === id);
        if (!entry) return null;

        if (!sceneObjectsRef.current.has(id)) {
          sceneObjectsRef.current.set(id, entry);
        }

        const Component = entry.component;

        return (
          <MemoizedComponent
            key={id}
            id={id}
            component={Component}
            coordinates={entry.coordinates}
            scale={entry.scale}
            rotation={entry.rotation}
            isPlaceholder={entry.isPlaceholder}
          />
        );
      })}
    </>
  );
};

interface MemoizedComponentProps {
  id: string;
  component: React.FC<any>;
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
  isPlaceholder: boolean;
}

const MemoizedComponent: React.FC<MemoizedComponentProps> = React.memo(
  ({ id, component: Component, coordinates, scale, rotation, isPlaceholder }) => (
    <PlaceholderWrapper isPlaceholder={isPlaceholder} coordinates={coordinates}>
      <Component key={id} coordinates={coordinates} scale={scale} rotation={rotation} />
    </PlaceholderWrapper>
  )
);
