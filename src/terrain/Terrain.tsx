import { useHeightfield } from "@react-three/cannon";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useState } from "react";
import * as THREE from "three";
import { ObjectPoolManager, spawnObject } from "../objects/ObjectPoolManager";
import { Dimension } from "../types/Dimension";

export const MAX_RENDER_DISTANCE = 2000;
export const CHUNK_SIZE = 250;
const CHUNK_RESOLUTION = 20;
const CHUNK_RADIUS = Math.ceil(MAX_RENDER_DISTANCE / CHUNK_SIZE);

interface Chunk {
  offset: THREE.Vector2;
  plane: THREE.Mesh;
  rebuildIterator: AsyncIterator<any> | null;
  collider: TerrainColliderProps | null;
}

interface Terrain {
  group: THREE.Group;
  chunks: { [key: string]: { position: number[]; chunk: Chunk } };
  active_chunk: Chunk | null;
  queued_chunks: Chunk[];
}

const terrain: Terrain = {
  group: new THREE.Group(),
  chunks: {},
  active_chunk: null,
  queued_chunks: [],
};

export const Terrain = ({ dimension }: { dimension: Dimension }) => {
  const { camera, scene } = useThree();
  const [gameLoaded, setGameLoaded] = useState(false);
  const [remainingChunks, setRemainingChunks] = useState<number | null>(null);
  const [totalChunks, setTotalChunks] = useState<number>(0);
  const [terrainMaterial, setTerrainMaterial] = useState<THREE.Material | null>(null);
  // const [spawners, setSpawners] = useState<{ [key: string]: TerrainSpawnerProps[] }>({}); //TODO move this to a context, handle object pooling etc from there. Or actually, you can put the chunkKey array in context and move all spawner logic there.

  scene.add(terrain.group);

  useEffect(() => {
    if (!gameLoaded) {
      if (remainingChunks !== null) {
        const progress = 1 - remainingChunks / totalChunks;
        console.log(`Loading progress: ${(progress * 100).toFixed(1)}%`);
      }
      remainingChunks === 0 && setGameLoaded(true);
    }
  }, [remainingChunks, gameLoaded]);

  useEffect(() => {
    dimension.getMaterial().then(setTerrainMaterial);
  }, []);

  useFrame(() => {
    if (terrainMaterial) {
      UpdateTerrain(terrainMaterial);
    }
  });

  const UpdateTerrain = async (material: THREE.Material) => {
    if (terrain.active_chunk) {
      const currentChunk = terrain.active_chunk;
      try {
        const iteratorResult = await terrain.active_chunk.rebuildIterator!.next();
        if (iteratorResult.done) {
          if (terrain.active_chunk === currentChunk) {
            terrain.active_chunk = null;
          }
          if (currentChunk.plane) {
            setTimeout(() => {
              currentChunk.plane.visible = true;
            }, 100);
          }
        }
      } catch (error) {
        console.error("Error updating terrain:", error);
        if (terrain.active_chunk === currentChunk) {
          terrain.active_chunk = null;
        }
      }
    } else {
      // Sort queued chunks by distance before popping
      if (terrain.queued_chunks.length > 0) {
        const playerX = camera.position.x;
        const playerZ = camera.position.z;

        // Filter out chunks that are too far away using actual distance
        terrain.queued_chunks = terrain.queued_chunks.filter((chunk) => {
          // Calculate actual distance to player for this chunk
          const distToPlayer = Math.sqrt(
            Math.pow(chunk.offset.x + CHUNK_SIZE / 2 - playerX, 2) +
              Math.pow(chunk.offset.y + CHUNK_SIZE / 2 - playerZ, 2)
          );
          return distToPlayer <= MAX_RENDER_DISTANCE * 2; //TODO dev note: multiplying by 2 prevents tiles within range from being deleted from queue
        });

        // Then sort remaining chunks by distance
        terrain.queued_chunks.sort((a, b) => {
          const distA = Math.sqrt(
            Math.pow(a.offset.x + CHUNK_SIZE / 2 - playerX, 2) + Math.pow(a.offset.y + CHUNK_SIZE / 2 - playerZ, 2)
          );
          const distB = Math.sqrt(
            Math.pow(b.offset.x + CHUNK_SIZE / 2 - playerX, 2) + Math.pow(b.offset.y + CHUNK_SIZE / 2 - playerZ, 2)
          );
          return distB - distA; // Changed to prioritize closest chunks
        });
      }

      const chunk = terrain.queued_chunks.pop();
      if (chunk) {
        terrain.active_chunk = chunk;
        terrain.active_chunk.rebuildIterator = BuildChunk(chunk, material);
      }
    }

    if (!terrain.active_chunk) {
      const playerX = camera.position.x;
      const playerZ = camera.position.z;
      const playerChunkX = Math.floor(playerX / CHUNK_SIZE);
      const playerChunkZ = Math.floor(playerZ / CHUNK_SIZE);

      // Calculate the maximum number of chunks in each direction
      // const maxChunks = Math.ceil(MAX_RENDER_DISTANCE / CHUNK_SIZE);
      const keys: { [key: string]: { position: number[] } } = {};

      // Generate chunks in a circular pattern
      for (let x = -CHUNK_RADIUS; x <= CHUNK_RADIUS; x++) {
        for (let z = -CHUNK_RADIUS; z <= CHUNK_RADIUS; z++) {
          // Calculate the distance from this chunk to the player's chunk //TODO dont think we need to do this
          // const distanceToPlayer = Math.sqrt(x * x + z * z) * CHUNK_SIZE;

          // Only include chunks within MAX_RENDER_DISTANCE //TODO dont think we need to do this
          // if (distanceToPlayer <= MAX_RENDER_DISTANCE) {
          const chunkX = playerChunkX + x;
          const chunkZ = playerChunkZ + z;
          const k = `${chunkX}/${chunkZ}`;
          keys[k] = { position: [chunkX, chunkZ] };
          // }
        }
      }

      // Remove chunks that are too far away
      for (const chunkKey in terrain.chunks) {
        if (!keys[chunkKey]) {
          DestroyChunk(chunkKey);
        }
      }

      // Add new chunks that are within range
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

        // // Calculate actual distance to player for this new chunk //TODO dont think we need to do this
        // const distToPlayer = Math.sqrt(
        //   Math.pow(offset.x + CHUNK_SIZE / 2 - playerX, 2) + Math.pow(offset.y + CHUNK_SIZE / 2 - playerZ, 2)
        // );

        // Double check we're within render distance before creating //TODO dont think we need to do this
        // if (distToPlayer <= MAX_RENDER_DISTANCE) {
        const chunk = QueueChunk(offset, CHUNK_SIZE, material);
        terrain.chunks[chunkKey] = {
          position: [playerChunkX, playerChunkZ],
          chunk: chunk,
          // };
        };
      }
    }

    if (remainingChunks === null) setTotalChunks(terrain.queued_chunks.length);
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

  const BuildChunk = async function* (chunk: Chunk, material: THREE.Material) {
    const offset = chunk.offset;
    const pos = chunk.plane.geometry.attributes.position;
    const attributeBuffers: any = {};

    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const vertexData = await dimension.getVertexData(v.x + offset.x, -v.y + offset.y);

      pos.setXYZ(i, v.x, v.y, vertexData.height);

      if (i === 0) {
        for (const attrName in vertexData.attributes) {
          attributeBuffers[attrName] = new Float32Array(pos.count);
        }
      }

      for (const attrName in vertexData.attributes) {
        if (attributeBuffers[attrName]) attributeBuffers[attrName][i] = vertexData.attributes[attrName];
      }
    }

    for (const attrName in attributeBuffers) {
      const bufferAttribute = new THREE.BufferAttribute(attributeBuffers[attrName], 1);
      chunk.plane.geometry.setAttribute(attrName, bufferAttribute);
    }

    // Apply material and update geometry immediately
    chunk.plane.material = material;
    chunk.plane.geometry.attributes.position.needsUpdate = true;
    chunk.plane.geometry.computeVertexNormals();
    chunk.plane.position.set(offset.x, 0, offset.y);

    // Generate spawners and colliders
    await GenerateSpawners(offset);
    GenerateColliders(chunk, offset);

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

  const GenerateSpawners = async (offset: THREE.Vector2) => {
    const points = await dimension.getSpawners(offset.x, offset.y);

    Promise.all(
      points.map(async ({ point, element }) => {
        const vertexData = await dimension.getVertexData(point.x, point.z);
        return spawnObject({
          component: element,
          coordinates: [point.x, vertexData.height, point.z],
        });
      })
    );
  };

  // setSpawners((prevSpawners) => ({
  //   ...prevSpawners,
  //   [chunkKey]: points.map(({ point, element }) => ({
  //     chunkKey: chunkKey,
  //     component: element,
  //     coordinates: [point.x, dimension.getVertexData(point.x, point.z).height, point.z],
  //   })),
  // }));

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
