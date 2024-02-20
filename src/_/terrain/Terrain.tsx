import { useHeightfield } from "@react-three/cannon";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";
import * as THREE from "three";
import { biomesInGame } from "../..";
import { Biome } from "../../types/Biome";
import { getBiomeData } from "./getBiomeData";
import { getMaterial } from "./getMaterial";

const CHUNK_SIZE = 160;
const CHUNK_RESOLUTION = 24;
const GRID_SIZE = 5;
const NUM_STEPS = 40; //TODO make this vary based on FPS?

interface Chunk {
  offset: THREE.Vector3;
  plane: THREE.Mesh;
  rebuildIterator: Iterator<any> | null;
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

export const Terrain = ({ biomes }: { biomes: Biome[] }) => {
  const { camera, scene } = useThree();
  const [gameLoaded, setGameLoaded] = useState(false);
  const [remainingChunks, setRemainingChunks] = useState<number | null>(null);
  const [colliders, setColliders] = useState<any[]>([]);
  const [terrainMaterial, setTerrainMaterial] = useState<THREE.Material | null>(null);

  scene.add(terrain.group);

  useEffect(() => {
    if (!gameLoaded) {
      let totalChunks = 1;
      for (let i = 0; i <= GRID_SIZE; i++) {
        totalChunks += 8 * i;
      }

      remainingChunks === 0 && setGameLoaded(true);
    }
  }, [remainingChunks]);

  useEffect(() => {
    getMaterial(biomes).then(setTerrainMaterial);
  }, []);

  useFrame(() => {
    if (terrainMaterial) {
      UpdateTerrain(terrainMaterial);
    }

    console.log(
      getBiomeData(camera.position.x, camera.position.z, biomesInGame).attributes.biome.name,
      getBiomeData(camera.position.x, camera.position.z, biomesInGame).attributes.secondaryBiome?.name
    );
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
        chunk.plane.visible = true;
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
    plane.castShadow = false;
    plane.receiveShadow = true;
    plane.rotation.x = -Math.PI / 2;
    terrain.group.add(plane);
    const chunk = {
      offset: new THREE.Vector3(offset.x, offset.y, 0),
      plane: plane,
      rebuildIterator: null,
    };

    chunk.plane.visible = false;
    terrain.queued_chunks.push(chunk);

    return chunk;
  };

  const BuildChunk = function* (chunk: any, material: THREE.Material) {
    const offset = chunk.offset;
    const pos = chunk.plane.geometry.attributes.position;
    let count = 0;
    const attributeBuffers: any = {};

    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const vertexData = getBiomeData(v.x + offset.x, -v.y + offset.y, biomes);

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
    setColliders((prev) => prev.filter((collider) => collider.key !== chunkKey));
  };

  const GenerateColliders = (chunk: any, offset: THREE.Vector2) => {
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

    const isDiff = !colliders.some((collider) => collider.pos[0] === offset.x && collider.pos[1] === offset.y);
    isDiff &&
      setColliders((prev) => [
        ...prev,
        {
          key: `${offset.x / CHUNK_SIZE}/${offset.y / CHUNK_SIZE}`,
          vector3Array: heightfield,
          pos: offset.toArray(),
          elementSize: CHUNK_SIZE / CHUNK_RESOLUTION,
        },
      ]);
  };

  return (
    <>
      {colliders.map((collider: TerrainColliderProps) => {
        return <TerrainCollider {...collider} />;
      })}
    </>
  );
};

export interface TerrainColliderProps {
  key: string;
  vector3Array: number[][];
  pos: number[];
  elementSize: number;
}

export const TerrainCollider: React.FC<TerrainColliderProps> = ({ vector3Array, pos, elementSize }) => {
  const [ref] = useHeightfield(() => ({
    args: [vector3Array, { elementSize }],
    position: [pos[0] + CHUNK_SIZE / 2, 0, pos[1] + CHUNK_SIZE / 2],
    rotation: [-Math.PI / 2, 0, Math.PI / 2],
  }));

  return <mesh ref={ref as any} />;
};
