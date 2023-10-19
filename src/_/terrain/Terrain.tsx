import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { _math } from "../math";
import { _noise } from "../noise";

const MIN_CELL_SIZE = 16;
const FIXED_GRID_SIZE = 5;
const MIN_CELL_RESOLUTION = 16;
const RADIUS = [100000, 100001];

interface Terrain {
  material: THREE.MeshBasicMaterial;
  group: THREE.Group;
  chunks: { [key: string]: any }; //TODO better typing
  active_chunk: any | null; //TODO better typing
  queued_chunks: any[]; //TODO better typing
  new_chunks: any[]; //TODO better typing and naming
  getHeight: (x: number, y: number) => number;
  getMaterial: (x: number, y: number) => string;
}

export interface TerrainNoiseParams {
  octaves: number;
  persistence: number;
  lacunarity: number;
  exponentiation: number;
  height: number;
  scale: number;
  // noise_type: string, //TODO bring this back if u ever find a use for having both perlin and simplex
  seed: number | string;
}

export const TerrainHeight = (
  params: TerrainNoiseParams,
  x: number,
  y: number
) => {
  const xs = x / params.scale;
  const ys = y / params.scale;
  const G = 2.0 ** -params.persistence;
  let amplitude = 1.0;
  let frequency = 1.0;
  let normalization = 0;
  let total = 0;
  for (let o = 0; o < params.octaves; o++) {
    const noiseValue =
      _noise.perlin(xs * frequency, ys * frequency) * 0.5 + 0.5;
    total += noiseValue * amplitude;
    normalization += amplitude;
    amplitude *= G;
    frequency *= params.lacunarity;
  }
  total /= normalization;
  return Math.pow(total, params.exponentiation) * params.height;
};

export const Terrain = ({
  getHeight,
  getMaterial,
}: {
  getHeight: (x: number, y: number) => number;
  getMaterial: (x: number, y: number) => string;
}) => {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  const terrain: Terrain = {
    material: new THREE.MeshBasicMaterial({
      wireframe: true,
      wireframeLinewidth: 1,
      color: 0x000000,
      side: THREE.FrontSide,
    }),
    group: new THREE.Group(),
    chunks: {},
    active_chunk: null,
    queued_chunks: [],
    new_chunks: [],
    getHeight: getHeight,
    getMaterial: getMaterial,
  };

  scene.add(terrain.group);

  useFrame(() => {
    UpdateTerrain();
  });

  const UpdateTerrain = () => {
    // console.log(this._biomes.GetVertexData(this.params.camera.position.x,this.params.camera.position.z)) //TODO something like this here (or elsewhere if it makes sense) to gather data about player location. you can useContext to store it and use it elsewhere

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
    const randomMaterial = terrain.material;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(
        size.x,
        size.z,
        MIN_CELL_RESOLUTION,
        MIN_CELL_RESOLUTION
      ),
      randomMaterial
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
    const NUM_STEPS = 5000; //TODO was 2000 originally (works well on chrome), 50 is more performant for firefox...make it variable based on browser? maybe make infinite for initial gen to make load time quicker
    const offset = chunk.offset;
    const pos = chunk.plane.geometry.attributes.position;
    const colours: any[] = [];
    let count = 0;

    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      pos.setXYZ(i, v.x, v.y, GenerateHeight(chunk, v)); //TODO add some x, y randomization?
      colours.push(
        GenerateMaterial(chunk, v.x + offset.x, v.z, -v.y + offset.y)
      );
      count++;

      if (count > NUM_STEPS) {
        count = 0;
        yield;
      }
    }

    yield;
    chunk.plane.geometry.elementsNeedUpdate = true;
    chunk.plane.geometry.verticesNeedUpdate = true;
    chunk.plane.geometry.computeVertexNormals();
    chunk.plane.position.set(offset.x, 0, offset.y);
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

    const heightAtVertex = terrain.getHeight(x, y);

    heightPairs.push([heightAtVertex, norm]);
    normalization += heightPairs[heightPairs.length - 1][1];

    if (normalization > 0) {
      for (const h of heightPairs) {
        z += (h[0] * h[1]) / normalization;
      }
    }

    return z;
  };

  const GenerateMaterial = (chunk: any, x: number, y: number, z: number) => {
    // Update this function to return the appropriate color based on the chunk type
    if (chunk.type === "GRASS") {
      return { r: 0, g: 1, b: 0 };
    }

    return { r: 1, g: 1, b: 1 };
  };

  return <></>;
};
