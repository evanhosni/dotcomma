import { useFrame, useThree } from "@react-three/fiber";
import React, { useCallback, useMemo, useState } from "react";
import { Apartment } from "../biomes/city/blocks/apartment/Apartment";
import { Dimension } from "../types/Dimension";
import { Spawner } from "../types/Spawner";

interface Spawners {
  group: Map<string, Spawner>;
}

export const Spawners = ({ dimension }: { dimension: Dimension }) => {
  const { camera } = useThree();
  const [spawners, setSpawners] = useState<Spawners>({ group: new Map() });

  const UpdateSpawners = useCallback(() => {
    const spawners1 = dimension.getSpawners(dimension, camera.position.x, camera.position.z);
    const currentKeys = new Set(spawners1.map((spawner) => JSON.stringify(spawner.point)));

    setSpawners((prevSpawners) => {
      const newGroup = new Map(prevSpawners.group);

      // Add new spawners
      spawners1.forEach((spawner) => {
        const key = JSON.stringify(spawner.point);
        if (!newGroup.has(key)) {
          newGroup.set(key, {
            key,
            component: Apartment,
            coordinates: [spawner.point.x, 0, spawner.point.z],
          });
        }
      });

      // Remove old spawners
      Array.from(newGroup.keys()).forEach((key) => {
        if (!currentKeys.has(key)) {
          newGroup.delete(key);
        }
      });

      return { group: newGroup };
    });
  }, [dimension, camera.position.x, camera.position.z]);

  useFrame(() => {
    UpdateSpawners();
  });

  const spawnerComponents = useMemo(() => {
    return Array.from(spawners.group.values()).map((spawner: Spawner) => (
      <TerrainSpawner key={spawner.key} {...spawner} />
    ));
  }, [spawners.group]);

  return <>{spawnerComponents}</>;
};

export const TerrainSpawner: React.FC<Spawner> = React.memo(({ coordinates }: Spawner) => {
  return <Apartment coordinates={coordinates} />;
});
