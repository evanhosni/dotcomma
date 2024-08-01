import { useHeightfield } from "@react-three/cannon";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useState } from "react";
import * as THREE from "three";
import { ObjectPoolManager, spawnObject } from "../objects/ObjectPoolManager";
import { Dimension } from "../types/Dimension";

export const CHUNK_SIZE = 200; //NOTE was 160
const CHUNK_RESOLUTION = 25; //NOTE was 25
const GRID_SIZE = 5; //NOTE was 5
const NUM_STEPS = 200; //TODO make this vary based on FPS?

interface Chunk {
  offset: THREE.Vector2;
  plane: THREE.Mesh;
  rebuildIterator: Iterator<any> | null;
  collider: TerrainColliderProps | null;
}

interface Terrain {
  group: THREE.Group;
  chunks: { [key: string]: { position: number[]; chunk: Chunk } };
  active_chunk: Chunk | null;
  queued_chunks: Chunk[];
  new_chunks: Chunk[];
}

const terrain: Terrain = {
  group: new THREE.Group(),
  chunks: {},
  active_chunk: null,
  queued_chunks: [],
  new_chunks: [],
};

export const Terrain = ({ dimension }: { dimension: Dimension }) => {
  const { camera, scene } = useThree();
  const [gameLoaded, setGameLoaded] = useState(false);
  const [remainingChunks, setRemainingChunks] = useState<number | null>(null);
  const [terrainMaterial, setTerrainMaterial] = useState<THREE.Material | null>(null);
  // const [spawners, setSpawners] = useState<{ [key: string]: TerrainSpawnerProps[] }>({}); //TODO move this to a context, handle object pooling etc from there. Or actually, you can put the chunkKey array in context and move all spawner logic there.

  scene.add(terrain.group);

  useEffect(() => {
    if (!gameLoaded) {
      let totalChunks = 1;
      for (let i = 0; i <= GRID_SIZE; i++) {
        totalChunks += 8 * i;
      }

      if (remainingChunks) {
        const progress = 1 - remainingChunks / totalChunks;
      }

      remainingChunks === 0 && setGameLoaded(true);
    }
  }, [remainingChunks]);

  useEffect(() => {
    dimension.getMaterial().then(setTerrainMaterial);
  }, []);

  useFrame(() => {
    if (terrainMaterial) {
      UpdateTerrain(terrainMaterial);
    }
  });

  const UpdateTerrain = (material: THREE.Material) => {
    if (terrain.active_chunk) {
      const iteratorResult = terrain.active_chunk.rebuildIterator!.next();
      if (iteratorResult.done) {
        terrain.active_chunk = null;
      }
    } else {
      const chunk = terrain.queued_chunks.pop();
      if (chunk) {
        terrain.active_chunk = chunk;
        terrain.active_chunk.rebuildIterator = BuildChunk(chunk, material);
        terrain.new_chunks.push(chunk);
      }
    }

    if (!terrain.queued_chunks.length) {
      for (const chunk of terrain.new_chunks) {
        setTimeout(() => {
          chunk.plane.visible = true;
        }, 100); //TODO potential solution to below "problemA". maybe make the material start fully transparent and here we can trigger it to fade in gradually? or hacky temp solution is to just use the setTimeout, like i am above
      }

      terrain.new_chunks = [];
    }

    if (!terrain.active_chunk) {
      const xp = camera.position.x + CHUNK_SIZE * 0.5;
      const yp = camera.position.z + CHUNK_SIZE * 0.5;
      const xc = Math.floor(xp / CHUNK_SIZE);
      const zc = Math.floor(yp / CHUNK_SIZE);
      const keys: { [key: string]: { position: number[] } } = {};

      for (let x = -GRID_SIZE; x <= GRID_SIZE; x++) {
        for (let z = -GRID_SIZE; z <= GRID_SIZE; z++) {
          const k = `${x + xc}/${z + zc}`;
          keys[k] = { position: [x + xc, z + zc] };
        }
      }

      for (const chunkKey in terrain.chunks) {
        if (!keys[chunkKey]) {
          DestroyChunk(chunkKey);
        }
      }

      const difference = { ...keys };
      for (const chunkKey in terrain.chunks) {
        delete difference[chunkKey];
      }

      for (const chunkKey in difference) {
        if (chunkKey in terrain.chunks) {
          continue;
        }

        const [xp, zp] = difference[chunkKey].position;
        const offset = new THREE.Vector2(xp * CHUNK_SIZE, zp * CHUNK_SIZE);
        const chunk = QueueChunk(offset, CHUNK_SIZE, material);
        terrain.chunks[chunkKey] = {
          position: [xc, zc],
          chunk: chunk,
        };
      }
    }

    setRemainingChunks(terrain.queued_chunks.length);
  };

  const QueueChunk = (offset: THREE.Vector2, width: number, material: THREE.Material) => {
    const size = new THREE.Vector3(width, 0, width);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.z, CHUNK_RESOLUTION, CHUNK_RESOLUTION), material);
    plane.visible = false; //TODO problemA: maybe somewhere around here, not sure. plane flashes briefly at 0,0,0 before moving to its correct spot. one solution is add 50 to the height or smth, but thats too hacky. try to prevent this flashing
    plane.castShadow = false;
    plane.receiveShadow = true;
    plane.rotation.x = -Math.PI / 2;
    const chunk = {
      offset: new THREE.Vector2(offset.x, offset.y),
      plane: plane,
      rebuildIterator: null,
      collider: null,
    };

    terrain.group.add(plane);
    terrain.queued_chunks.push(chunk);

    return chunk;
  };

  const BuildChunk = function* (chunk: Chunk, material: THREE.Material) {
    const offset = chunk.offset;
    const pos = chunk.plane.geometry.attributes.position;
    let count = 0;
    const attributeBuffers: any = {};

    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const vertexData = dimension.getVertexData(v.x + offset.x, -v.y + offset.y);

      pos.setXYZ(i, v.x, v.y, vertexData.height);

      if (i === 0) {
        for (const attrName in vertexData.attributes) {
          attributeBuffers[attrName] = new Float32Array(pos.count);
        }
      }

      for (const attrName in vertexData.attributes) {
        if (attributeBuffers[attrName]) attributeBuffers[attrName][i] = vertexData.attributes[attrName];
      }

      if (++count > NUM_STEPS && gameLoaded) {
        count = 0;
        yield;
      }
    }

    for (const attrName in attributeBuffers) {
      const bufferAttribute = new THREE.BufferAttribute(attributeBuffers[attrName], 1);
      chunk.plane.geometry.setAttribute(attrName, bufferAttribute);
    }

    chunk.plane.material = material;
    chunk.plane.geometry.attributes.position.needsUpdate = true;
    chunk.plane.geometry.computeVertexNormals();
    chunk.plane.position.set(offset.x, 0, offset.y);

    GenerateColliders(chunk, offset);
    GenerateSpawners(offset);

    yield;
  };

  const DestroyChunk = (chunkKey: string) => {
    const chunkData = terrain.chunks[chunkKey];
    if (chunkData && chunkData.chunk && chunkData.chunk.plane) {
      chunkData.chunk.plane.geometry.dispose();
      (chunkData.chunk.plane.material as THREE.Material).dispose();
      terrain.group.remove(chunkData.chunk.plane);
    }
    delete terrain.chunks[chunkKey];
  };

  const GenerateColliders = (chunk: Chunk, offset: THREE.Vector2) => {
    const linearArray = chunk.plane.geometry.attributes.position.array;
    const gridSize = Math.sqrt(linearArray.length / 3);
    const heightfield = Array.from({ length: gridSize }, () => Array(gridSize).fill(0));

    for (let i = 0; i < linearArray.length; i += 3) {
      const x = linearArray[i];
      const z = linearArray[i + 1];
      const height = linearArray[i + 2];

      const xIndex = Math.round((x - -(CHUNK_SIZE / 2)) / (CHUNK_SIZE / CHUNK_RESOLUTION));
      const zIndex = Math.round((z - -(CHUNK_SIZE / 2)) / (CHUNK_SIZE / CHUNK_RESOLUTION));

      const transformedXIndex = CHUNK_RESOLUTION - xIndex;

      if (
        zIndex >= 0 &&
        zIndex < CHUNK_RESOLUTION + 1 &&
        transformedXIndex >= 0 &&
        transformedXIndex < CHUNK_RESOLUTION + 1
      ) {
        heightfield[zIndex][transformedXIndex] = height;
      }
    }

    const chunkKey = `${offset.x / CHUNK_SIZE}/${offset.y / CHUNK_SIZE}`;
    chunk.collider = {
      chunkKey: chunkKey,
      heightfield,
      position: offset.toArray(),
      elementSize: CHUNK_SIZE / CHUNK_RESOLUTION,
    };
  };

  const GenerateSpawners = (offset: THREE.Vector2) => {
    const points = dimension.getSpawners(offset.x, offset.y);
    const chunkKey = `${offset.x / CHUNK_SIZE}/${offset.y / CHUNK_SIZE}`;

    points.forEach(({ point, element }, index) =>
      spawnObject({
        component: element,
        coordinates: [point.x, dimension.getVertexData(point.x, point.z).height, point.z],
      })
    );

    // setSpawners((prevSpawners) => ({
    //   ...prevSpawners,
    //   [chunkKey]: points.map(({ point, element }) => ({
    //     chunkKey: chunkKey,
    //     component: element,
    //     coordinates: [point.x, dimension.getVertexData(point.x, point.z).height, point.z],
    //   })),
    // }));
  };

  return (
    <>
      <ObjectPoolManager />
      {Object.values(terrain.chunks).map(({ chunk }) => {
        if (chunk.collider) {
          return <TerrainCollider key={chunk.collider.chunkKey} {...chunk.collider} />;
        }
        return null;
      })}
      {/* {Object.values(spawners)
        .flat()
        .map(({ chunkKey, component: Component, coordinates, scale, rotation }: TerrainSpawnerProps, index) => {
          return <Component key={index} coordinates={coordinates} scale={scale} rotation={rotation} />;
        })} */}
    </>
  );
};

export interface TerrainColliderProps {
  chunkKey: string;
  heightfield: number[][];
  position: number[];
  elementSize: number;
}

export const TerrainCollider: React.FC<TerrainColliderProps> = ({ heightfield, position, elementSize }) => {
  const [ref] = useHeightfield(() => ({
    args: [heightfield, { elementSize }],
    position: [position[0] + CHUNK_SIZE / 2, 0, position[1] + CHUNK_SIZE / 2],
    rotation: [-Math.PI / 2, 0, Math.PI / 2],
  }));

  return <mesh ref={ref as any} />;
};

export interface TerrainSpawnerProps {
  key?: string;
  chunkKey: string;
  component?: any; //TODO get proper type
  coordinates: THREE.Vector3Tuple;
  scale?: THREE.Vector3Tuple;
  rotation?: THREE.Vector3Tuple;
}
