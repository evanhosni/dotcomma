import { math } from '../engine/math/math.js';
import { biomes } from './biomes.js';

const _MIN_CELL_SIZE = 1600;
const _FIXED_GRID_SIZE = 5;
const _MIN_CELL_RESOLUTION = 16;

export const terrain = (()=>{

  class TerrainChunkManager {
    constructor(params) {
      this._params = params;
      this._material = new THREE.MeshBasicMaterial({ wireframe: true, wireframeLinewidth: 1, color: 0xFFFFFF, side: THREE.FrontSide });
      this._materialArray = [
        new THREE.MeshBasicMaterial({ wireframe: true, wireframeLinewidth: 1, color: 0x00FFFF, side: THREE.FrontSide }),
        new THREE.MeshBasicMaterial({ wireframe: true, wireframeLinewidth: 1, color: 0xFF00FF, side: THREE.FrontSide }),
        new THREE.MeshBasicMaterial({ wireframe: true, wireframeLinewidth: 1, color: 0xFFFF00, side: THREE.FrontSide }),
        new THREE.MeshBasicMaterial({ wireframe: true, wireframeLinewidth: 1, color: 0x0000FF, side: THREE.FrontSide }),
        new THREE.MeshBasicMaterial({ wireframe: true, wireframeLinewidth: 1, color: 0xFF0000, side: THREE.FrontSide })
      ];
      this._biomes = new biomes.Biomes();
      this._group = new THREE.Group();
      this._params.scene.add(this._group);
      this.chunks = {};
      this._pool = {};
      this._active = null;
      this._queued = [];
      this._new = [];
      this.Reset();
    }

    CreateTerrainChunk(offset, width) {
      const size = new THREE.Vector3(width, 0, width);
      const randomMaterial = this._materialArray[Math.floor(Math.random() * this._materialArray.length)];
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(size.x, size.z, _MIN_CELL_RESOLUTION, _MIN_CELL_RESOLUTION),
        randomMaterial
      );
      plane.castShadow = false;
      plane.receiveShadow = true;
      plane.rotation.x = -Math.PI / 2;
      this._group.add(plane);
  
      const heightGenerators = [new HeightGenerator(this._biomes, offset, 100000, 100000 + 1)];
  
      const chunk = {
        offset: new THREE.Vector3(offset.x, offset.y, 0),
        plane: plane,
        heightGenerators: heightGenerators,
        rebuildIterator: null
      };

      chunk.plane.visible = false;
      this._queued.push(chunk);
  
      return chunk;
    }

    Reset() {
      for (let chunkKey in this.chunks) {
        this.DestroyChunk(chunkKey);
      }
  
      this.chunks = {};
      this._active = null;
      this._queued = [];
      this._new = [];
    }
  
    Update() {
      this.UpdateChunks();
      if (!this._active) {
        const camera = this._params.camera;
        const xp = camera.position.x + _MIN_CELL_SIZE * 0.5;
        const yp = camera.position.z + _MIN_CELL_SIZE * 0.5;
        const xc = Math.floor(xp / _MIN_CELL_SIZE);
        const zc = Math.floor(yp / _MIN_CELL_SIZE);
        const keys = {};
  
        for (let x = -_FIXED_GRID_SIZE; x <= _FIXED_GRID_SIZE; x++) {
          for (let z = -_FIXED_GRID_SIZE; z <= _FIXED_GRID_SIZE; z++) {
            const k = `${x + xc}/${z + zc}`;
            keys[k] = { position: [x + xc, z + zc] };
          }
        }
  
        for (let chunkKey in this.chunks) {
          if (!keys[chunkKey]) {
            this.DestroyChunk(chunkKey);
          }
        }
  
        const difference = { ...keys };
        for (let chunkKey in this.chunks) {
          delete difference[chunkKey];
        }
  
        for (let chunkKey in difference) {
          if (chunkKey in this.chunks) {
            continue;
          }
  
          const [xp, zp] = difference[chunkKey].position;
          const offset = new THREE.Vector2(xp * _MIN_CELL_SIZE, zp * _MIN_CELL_SIZE);
          const chunk = this.CreateTerrainChunk(offset, _MIN_CELL_SIZE);
          this.chunks[chunkKey] = {
            position: [xc, zc],
            chunk: chunk
          };
        }
      }
    }
  
    UpdateChunks() {
      if (this._active) {
        const iteratorResult = this._active.rebuildIterator.next();
        if (iteratorResult.done) {
          this._active = null;
        }
      } else {
        const chunk = this._queued.pop();
        if (chunk) {
          this._active = chunk;
          this._active.rebuildIterator = this.RebuildChunk(chunk);
          this._new.push(chunk);
        }
      }
  
      if (this._active) {
        return;
      }
  
      if (!this._queued.length) {
        for (let chunk of this._new) {
          chunk.plane.visible = true;
        }
  
        this._new = [];
      }
    }
  
    *RebuildChunk(chunk) {
      const NUM_STEPS = 2000;
      const offset = chunk.offset;
      const pos = chunk.plane.geometry.attributes.position;
      const colours = [];
      let count = 0;
  
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
        pos.setXYZ(i, v.x, v.y, this.GenerateHeight(chunk, v));
        colours.push(this.GenerateColor(chunk, v.x + offset.x, v.z, -v.y + offset.y));
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
    }
  
    GenerateHeight(chunk, v) {
      const offset = chunk.offset;
      const heightGenerators = chunk.heightGenerators;
      const heightPairs = [];
      let normalization = 0;
      let z = 0;
  
      for (let gen of heightGenerators) {
        heightPairs.push(gen.Get(v.x + offset.x, -v.y + offset.y));
        normalization += heightPairs[heightPairs.length - 1][1];
      }
  
      if (normalization > 0) {
        for (let h of heightPairs) {
          z += h[0] * h[1] / normalization;
        }
      }
  
      return z;
    }
  
    GenerateColor(chunk, x, y, z) {
      if (chunk.type === "GRASS") {
        return { r: 0, g: 1, b: 0 };
      }
  
      return { r: 1, g: 1, b: 1 };
    }
  
    DestroyChunk(chunkKey) {
      const chunkData = this.chunks[chunkKey];
      chunkData.chunk.plane.geometry.dispose();
      chunkData.chunk.plane.material.dispose();
      this._group.remove(chunkData.chunk.plane);
      delete this.chunks[chunkKey];
    }
  }

  class HeightGenerator {
    constructor(biomes, position, minRadius, maxRadius) {
      this._position = position.clone();
      this._radius = [minRadius, maxRadius];
      this._biomes = biomes;
    }

    Get(x, y) {
      const distance = this._position.distanceTo(new THREE.Vector2(x, y));
      let normalization = 1.0 - math.sat((distance - this._radius[0]) / (this._radius[1] - this._radius[0]));
      normalization = normalization * normalization * (3 - 2 * normalization);

      let heightAtVertex = this._biomes.Height(x, y);

      return [heightAtVertex, normalization];
    }
  }

  return {
    TerrainChunkManager: TerrainChunkManager
  };
})();