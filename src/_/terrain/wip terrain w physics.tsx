import { useFrame, useThree } from "@react-three/fiber";
import * as CANNON from "cannon-es";
import { useEffect, useState } from "react";
import * as THREE from "three";
import { Biome } from "../../types/Biome";
import { _math } from "../math";

const MIN_CELL_SIZE = 32;
const FIXED_GRID_SIZE = 10;
const MIN_CELL_RESOLUTION = 8;

interface Chunk {
  offset: THREE.Vector3;
  plane: THREE.Mesh;
  rebuildIterator: Generator | null;
  physicsBody?: CANNON.Body;
}

interface Terrain {
  group: THREE.Group;
  chunks: { [key: string]: { position: number[]; chunk: Chunk } };
  active_chunk: Chunk | null;
  queued_chunks: Chunk[];
  new_chunks: Chunk[];
}

const terrainPhysicsMaterial = new CANNON.Material({
  friction: 0.0,
  restitution: 0.3,
});

const convertToHeightfieldData = (geometry: THREE.BufferGeometry): number[][] => {
  const positions = geometry.attributes.position.array;
  const size = Math.sqrt(positions.length / 3);
  const data: number[][] = [];

  for (let i = 0; i < size; i++) {
    const row: number[] = [];
    for (let j = 0; j < size; j++) {
      const height = (positions as unknown as number[])[3 * (i * size + j) + 1];
      row.push(height);
    }
    data.push(row);
  }
  return data;
};

const createPhysicsBodyForChunk = (chunk: Chunk, material: THREE.Material): CANNON.Body => {
  const heightfieldData = convertToHeightfieldData(chunk.plane.geometry as THREE.BufferGeometry);
  const heightfieldShape = new CANNON.Heightfield(heightfieldData, {
    elementSize: MIN_CELL_SIZE / MIN_CELL_RESOLUTION,
  });
  const body = new CANNON.Body({
    mass: 0,
    shape: heightfieldShape,
    material: terrainPhysicsMaterial,
  });
  body.position.set(chunk.offset.x, 0, chunk.offset.y);
  body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  return body;
};

const addChunkToPhysicsWorld = (chunk: Chunk, material: THREE.Material, world: CANNON.World): void => {
  const body = createPhysicsBodyForChunk(chunk, material);
  chunk.physicsBody = body;
  world.addBody(body);
};

export const Terrain: React.FC<{ biome: Biome; world: CANNON.World }> = ({ biome, world }) => {
  const { camera, scene } = useThree();
  const terrain: Terrain = {
    group: new THREE.Group(),
    chunks: {},
    active_chunk: null,
    queued_chunks: [],
    new_chunks: [],
  };
  scene.add(terrain.group);

  const [terrainMaterial, setTerrainMaterial] = useState<THREE.Material | null>(null);

  useEffect(() => {
    biome.getMaterial().then(setTerrainMaterial);
  }, [biome]);

  useFrame(() => {
    if (terrainMaterial) {
      UpdateTerrain(terrainMaterial);
    }
  });

  const QueueChunk = (offset: THREE.Vector2, width: number, material: THREE.Material): Chunk => {
    const size = new THREE.Vector3(width, 0, width);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size.x, size.z, MIN_CELL_RESOLUTION, MIN_CELL_RESOLUTION),
      material
    );
    plane.castShadow = false;
    plane.receiveShadow = true;
    plane.rotation.x = -Math.PI / 2;
    terrain.group.add(plane);
    const chunk: Chunk = {
      offset: new THREE.Vector3(offset.x, offset.y, 0),
      plane: plane,
      rebuildIterator: null,
    };
    chunk.plane.visible = false;
    terrain.queued_chunks.push(chunk);
    addChunkToPhysicsWorld(chunk, material, world);
    return chunk;
  };

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
      const xp = camera.position.x + MIN_CELL_SIZE * 0.5;
      const yp = camera.position.z + MIN_CELL_SIZE * 0.5;
      const xc = Math.floor(xp / MIN_CELL_SIZE);
      const zc = Math.floor(yp / MIN_CELL_SIZE);
      const keys: { [key: string]: { position: number[] } } = {};

      for (let x = -FIXED_GRID_SIZE; x <= FIXED_GRID_SIZE; x++) {
        for (let z = -FIXED_GRID_SIZE; z <= FIXED_GRID_SIZE; z++) {
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
        const offset = new THREE.Vector2(xp * MIN_CELL_SIZE, zp * MIN_CELL_SIZE);
        const chunk = QueueChunk(offset, MIN_CELL_SIZE, material);
        terrain.chunks[chunkKey] = {
          position: [xc, zc],
          chunk: chunk,
        };
      }
    }
  };

  const BuildChunk = function* (chunk: any, material: THREE.Material) {
    const NUM_STEPS = 5000;
    const offset = chunk.offset;
    const pos = chunk.plane.geometry.attributes.position;
    let count = 0;
    const attributeBuffers: any = {};

    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      pos.setXYZ(i, v.x, v.y, GenerateHeight(chunk, v));

      const vertexData = biome.getVertexData(v.x + offset.x, -v.y + offset.y);

      if (i === 0) {
        for (const attrName in vertexData.attributes) {
          attributeBuffers[attrName] = new Float32Array(pos.count);
        }
      }

      for (const attrName in vertexData.attributes) {
        attributeBuffers[attrName][i] = vertexData.attributes[attrName];
      }

      if (++count > NUM_STEPS) {
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

    yield;
  };

  const GenerateHeight = (chunk: any, v: THREE.Vector3) => {
    const offset = chunk.offset;
    const heightPairs: number[][] = [];
    let normalization = 0;
    let z = 0;
    const x = v.x + offset.x;
    const y = -v.y + offset.y;

    const position = new THREE.Vector2(offset.x, offset.y);

    const distance = position.distanceTo(new THREE.Vector2(x, y));
    let norm = 1.0 - _math.sat((distance - 100000) / 1);
    norm = norm * norm * (3 - 2 * norm);

    const heightAtVertex = biome.getVertexData(x, y).height;

    heightPairs.push([heightAtVertex, norm]);
    normalization += heightPairs[heightPairs.length - 1][1];

    if (normalization > 0) {
      for (const h of heightPairs) {
        z += (h[0] * h[1]) / normalization;
      }
    }

    return z;
  };

  const DestroyChunk = (chunkKey: string): void => {
    const chunkData = terrain.chunks[chunkKey];
    if (chunkData && chunkData.chunk && chunkData.chunk.plane) {
      chunkData.chunk.plane.geometry.dispose();
      // chunkData.chunk.plane.material.dispose();
      terrain.group.remove(chunkData.chunk.plane);
      if (chunkData.chunk.physicsBody) {
        world.removeBody(chunkData.chunk.physicsBody);
      }
    }
    delete terrain.chunks[chunkKey];
  };

  return <></>;
};
