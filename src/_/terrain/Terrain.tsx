import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
// import { getVertexData } from "../../biomes/city/props/getVertexData";
import { Biome } from "../../types/Biome";
import { _math } from "../math";

const MIN_CELL_SIZE = 32;
const FIXED_GRID_SIZE = 10;
const MIN_CELL_RESOLUTION = 8;
const RADIUS = [100000, 100001];

interface Terrain {
  group: THREE.Group;
  chunks: { [key: string]: any }; //TODO better typing
  active_chunk: any | null; //TODO better typing
  queued_chunks: any[]; //TODO better typing
  new_chunks: any[]; //TODO better typing and naming
  biome: Biome;
}

export const Terrain = ({ biome }: { biome: Biome }) => {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  const terrain: Terrain = {
    group: new THREE.Group(),
    chunks: {},
    active_chunk: null,
    queued_chunks: [],
    new_chunks: [],
    biome: biome,
  };

  scene.add(terrain.group);

  useFrame(() => {
    UpdateTerrain();
  });

  const UpdateTerrain = () => {
    if (terrain.active_chunk) {
      const iteratorResult = terrain.active_chunk.rebuildIterator.next();
      if (iteratorResult.done) {
        terrain.active_chunk = null;
      }
    } else {
      const chunk = terrain.queued_chunks.pop();
      if (chunk) {
        terrain.active_chunk = chunk;
        terrain.active_chunk.rebuildIterator = BuildChunk(chunk);
        terrain.new_chunks.push(chunk);
      }
    }

    if (terrain.active_chunk) {
      return;
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
        const offset = new THREE.Vector2(
          xp * MIN_CELL_SIZE,
          zp * MIN_CELL_SIZE
        );
        const chunk = QueueChunk(offset, MIN_CELL_SIZE);
        terrain.chunks[chunkKey] = {
          position: [xc, zc],
          chunk: chunk,
        };
      }
    }
  };

  const QueueChunk = (offset: THREE.Vector2, width: number) => {
    const size = new THREE.Vector3(width, 0, width);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(
        size.x,
        size.z,
        MIN_CELL_RESOLUTION,
        MIN_CELL_RESOLUTION
      ),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
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

  const BuildChunk = function* (chunk: any) {
    const NUM_STEPS = 5000;
    const offset = chunk.offset;
    const pos = chunk.plane.geometry.attributes.position;
    const material = terrain.biome.material;

    let count = 0;

    const vertexDataArray = [];
    const attributeBuffers: any = {};

    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      pos.setXYZ(i, v.x, v.y, GenerateHeight(chunk, v));

      const vertexData = terrain.biome.getVertexData(
        v.x + offset.x,
        -v.y + offset.y
      );
      vertexDataArray.push(vertexData);

      // Initialize buffers on the first iteration
      if (i === 0) {
        for (const attrName in vertexData.attributes) {
          attributeBuffers[attrName] = new Float32Array(pos.count);
        }
      }

      // Populate buffers
      for (const attrName in vertexData.attributes) {
        attributeBuffers[attrName][i] = vertexData.attributes[attrName];
      }

      if (++count > NUM_STEPS) {
        count = 0;
        yield;
      }
    }

    // Set attributes on geometry
    for (const attrName in attributeBuffers) {
      const bufferAttribute = new THREE.BufferAttribute(
        attributeBuffers[attrName],
        1
      );
      chunk.plane.geometry.setAttribute(attrName, bufferAttribute);
    }

    chunk.plane.material = material;
    chunk.plane.geometry.attributes.position.needsUpdate = true;
    chunk.plane.geometry.computeVertexNormals();
    chunk.plane.position.set(offset.x, 0, offset.y);

    yield;
  };

  const DestroyChunk = (chunkKey: string) => {
    const chunkData = terrain.chunks[chunkKey];
    chunkData.chunk.plane.geometry.dispose();
    chunkData.chunk.plane.material.dispose();
    terrain.group.remove(chunkData.chunk.plane);
    delete terrain.chunks[chunkKey];
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
    let norm =
      1.0 - _math.sat((distance - RADIUS[0]) / (RADIUS[1] - RADIUS[0]));
    norm = norm * norm * (3 - 2 * norm);

    const heightAtVertex = terrain.biome.getVertexData(x, y).height;

    heightPairs.push([heightAtVertex, norm]);
    normalization += heightPairs[heightPairs.length - 1][1];

    if (normalization > 0) {
      for (const h of heightPairs) {
        z += (h[0] * h[1]) / normalization;
      }
    }

    return z;
  };

  return <></>;
};
