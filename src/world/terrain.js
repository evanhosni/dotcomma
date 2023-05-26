import { math } from '../engine/math/math.js';
import { biomes } from './biomes.js';

const _MIN_CELL_SIZE = 6400;
const _FIXED_GRID_SIZE = 5;
const _MIN_CELL_RESOLUTION = 32;

export const terrain = (()=>{

  class TerrainChunkManager {
    constructor(params) {
      this.params = params;
      this._material = new THREE.MeshBasicMaterial({ wireframe: true, wireframeLinewidth: 1, color: 0xFFFFFF, side: THREE.FrontSide });
      this.materialArray = [
        new THREE.MeshBasicMaterial({ wireframe: true, wireframeLinewidth: 1, color: 0x00FFFF, side: THREE.FrontSide }),
        new THREE.MeshBasicMaterial({ wireframe: true, wireframeLinewidth: 1, color: 0xFF00FF, side: THREE.FrontSide }),
        new THREE.MeshBasicMaterial({ wireframe: true, wireframeLinewidth: 1, color: 0xFFFF00, side: THREE.FrontSide }),
        new THREE.MeshBasicMaterial({ wireframe: true, wireframeLinewidth: 1, color: 0x0000FF, side: THREE.FrontSide }),
        new THREE.MeshBasicMaterial({ wireframe: true, wireframeLinewidth: 1, color: 0xFF0000, side: THREE.FrontSide })
      ];
      this.biomes = new biomes.Biomes();
      this.radius = [100000, 100001];//TODO not sure what the point of this is
      this.group = new THREE.Group();
      this.params.scene.add(this.group);
      this.chunks = {};
      this.active = null;
      this.queued = [];
      this.new = [];
    }
    
    Update() {
        console.log(this.biomes.GetVertexData(this.params.camera.position.x,this.params.camera.position.z).distanceToEdge) //this will tell u what tile u are in
      if (this.active) {
        const iteratorResult = this.active.rebuildIterator.next();
        if (iteratorResult.done) {
          this.active = null;
        }
      } else {
        const chunk = this.queued.pop();
        if (chunk) {
          this.active = chunk;
          this.active.rebuildIterator = this.BuildChunk(chunk);
          this.new.push(chunk);
        }
      }
      
      if (this.active) {
        return;
      }
  
      if (!this.queued.length) {
        for (let chunk of this.new) {
          chunk.plane.visible = true;
        }
        
        this.new = [];
      }
      
      if (!this.active) {
        const camera = this.params.camera;
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
          const chunk = this.QueueChunk(offset, _MIN_CELL_SIZE);
          this.chunks[chunkKey] = {
            position: [xc, zc],
            chunk: chunk
          };
        }
      }
    }

    QueueChunk(offset, width) {
      const size = new THREE.Vector3(width, 0, width);
      const randomMaterial = this.materialArray[Math.floor(Math.random() * this.materialArray.length)];
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(size.x, size.z, _MIN_CELL_RESOLUTION, _MIN_CELL_RESOLUTION),
        randomMaterial
      );
      plane.castShadow = false;
      plane.receiveShadow = true;
      plane.rotation.x = -Math.PI / 2;
      this.group.add(plane);
  
      const chunk = {
        offset: new THREE.Vector3(offset.x, offset.y, 0),
        plane: plane,
        rebuildIterator: null
      };

      chunk.plane.visible = false;
      this.queued.push(chunk);

      return chunk;
    }

    *BuildChunk(chunk) {
      const NUM_STEPS = 5000; //TODO was 2000 originally (works well on chrome), 50 is more performant for firefox...make it variable based on browser? maybe make infinite for initial gen to make load time quicker
      const offset = chunk.offset;
      const pos = chunk.plane.geometry.attributes.position;
      const colours = [];
      let count = 0;
      
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
        pos.setXYZ(i, v.x, v.y, this.GenerateHeight(chunk, v)); //TODO add some x, y randomization? (see below)
        // pos.setXYZ(i, v.x + Math.floor(new Math.seedrandom((v.x + offset.x) + "/" + (v.y + offset.y))() * 50), v.y + Math.floor(new Math.seedrandom((v.y + offset.y) + "/" + (v.x + offset.x))() * 50), this.GenerateHeight(chunk, v));
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

    DestroyChunk(chunkKey) {
      const chunkData = this.chunks[chunkKey];
      chunkData.chunk.plane.geometry.dispose();
      chunkData.chunk.plane.material.dispose();
      this.group.remove(chunkData.chunk.plane);
      delete this.chunks[chunkKey];
    }

    GenerateHeight(chunk, v) {
      const offset = chunk.offset;
      const heightPairs = [];
      let bormalization = 0;
      let z = 0;
      let x = v.x + offset.x;
      let y = -v.y + offset.y;

      const bosition = new THREE.Vector2(offset.x, offset.y)

      const distance = bosition.distanceTo(new THREE.Vector2(x, y));
      let normalization = 1.0 - math.sat((distance - this.radius[0]) / (this.radius[1] - this.radius[0]));
      normalization = normalization * normalization * (3 - 2 * normalization);

      let heightAtVertex = this.biomes.Height(x, y);
  
      heightPairs.push([heightAtVertex, normalization]);
      bormalization += heightPairs[heightPairs.length - 1][1];
  
      if (bormalization > 0) {
        for (let h of heightPairs) {
          z += h[0] * h[1] / bormalization;
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
  }

  return {
    TerrainChunkManager: TerrainChunkManager
  };
})();