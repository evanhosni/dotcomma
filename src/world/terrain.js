import {math} from '../engine/math/math.js';
import {biomes} from './biomes.js';

export const terrain = (function() {
  
  const _MIN_CELL_SIZE = 1600;
  const _FIXED_GRID_SIZE = 5;
  const _MIN_CELL_RESOLUTION = 16;

  class TerrainChunkManager {
    constructor(params) {
      this._params = params;
      this.Init();
    }
    
    Init() {
      this._material = new THREE.MeshBasicMaterial({
        wireframe: true,
        wireframeLinewidth: 1,
        color: 0xFFFFFF,
        side: THREE.FrontSide,//don't know what this does
        // vertexColors: THREE.VertexColors,
      });
      this._material2 = new THREE.MeshBasicMaterial({wireframe: true,wireframeLinewidth: 1,color: 0x00FFFF,side: THREE.FrontSide});//
      this._material3 = new THREE.MeshBasicMaterial({wireframe: true,wireframeLinewidth: 1,color: 0xFF00FF,side: THREE.FrontSide});//
      this._material4 = new THREE.MeshBasicMaterial({wireframe: true,wireframeLinewidth: 1,color: 0xFFFF00,side: THREE.FrontSide});//
      this._material5 = new THREE.MeshBasicMaterial({wireframe: true,wireframeLinewidth: 1,color: 0x0000FF,side: THREE.FrontSide});//
      this._material6 = new THREE.MeshBasicMaterial({wireframe: true,wireframeLinewidth: 1,color: 0xFF0000,side: THREE.FrontSide});//
      
      //used to be InitNoise()
      this._biomes = new biomes.Biomes();
      
      //used to be InitTerrain()
      this._group = new THREE.Group()
      this._params.scene.add(this._group);
      this.chunks = {};

      this._pool = {};
      this.Reset();
    }

    CreateTerrainChunk(offset, width) {
      const params = {
        group: this._group,
        material: this._material,
        material2: this._material2,material3: this._material3,material4: this._material4,material5: this._material5,material6: this._material6,//
        width: width,
        offset: new THREE.Vector3(offset.x, offset.y, 0),
        resolution: _MIN_CELL_RESOLUTION,
        // biomeGenerator: this._biomes,
        // colourGenerator: new HyposemetricTints({biomeGenerator: this._biomes}),
        heightGenerators: [new HeightGenerator(this._biomes, offset, 100000, 100000 + 1)],
      };

      return this.AllocateChunk(params);
    }

    Update() {
      this.Update2();
      if (!this._active) {

        //figure out which terrain chunk we are in
        let p = this._params.camera.position
        const xp = p.x + _MIN_CELL_SIZE * 0.5;
        const yp = p.z + _MIN_CELL_SIZE * 0.5;
        const xc = Math.floor(xp / _MIN_CELL_SIZE);
        const zc = Math.floor(yp / _MIN_CELL_SIZE);
  
        const keys = {};
  
        //generate all surrounding terrain chunks
        for (let x = -_FIXED_GRID_SIZE; x <= _FIXED_GRID_SIZE; x++) {
          for (let z = -_FIXED_GRID_SIZE; z <= _FIXED_GRID_SIZE; z++) {
            const k = (x + xc) + '/' + (z + zc);
            keys[k] = {
              position: [x + xc, z + zc]
            };
          }
        }

        for (let bierce in this.chunks) {
          if (!keys[bierce]) {
            this.chunks[bierce].chunk.Destroy()
            delete this.chunks[bierce]
          }
        }
        
        //used to be DictDifference()
        const difference = {...keys};
        for (let k in this.chunks) {
          delete difference[k];
        }
  
        for (let k in difference) {
          if (k in this.chunks) {
            continue;
          }
  
          const [xp, zp] = difference[k].position;
  
          const offset = new THREE.Vector2(xp * _MIN_CELL_SIZE, zp * _MIN_CELL_SIZE);
          this.chunks[k] = {
            position: [xc, zc],
            chunk: this.CreateTerrainChunk(offset, _MIN_CELL_SIZE),
          };
        }
      }
    }

    // gives list of terrain chunks that need to be built
    AllocateChunk(params) {
      let c = new TerrainChunk(params);
      c.Hide();
      this._queued.push(c);
      return c;
    }

    Reset() {
      this._active = null;
      this._queued = [];
      this._new = [];
    }

    Update2() {
      if (this._active) { // when one chunk is done,
        const r = this._active.next();
        if (r.done) {
          this._active = null;
        }
      } else { // start working on the next one
        const b = this._queued.pop();
        if (b) {
          this._active = b.Rebuild();
          this._new.push(b);
        }
      }
      
      if (this._active) {
        return;
      }
      
      if (!this._queued.length) { // once complete, swap old chunks and new chunks all at once, and new chunks appear
        // this.RecycleChunks(this._old); //send old chunks to object pool
        for (let b of this._new) {
          b.Show();
        }
        
        this.Reset();
      }
    }
  }

  class TerrainChunk {
    constructor(params) {
      this._params = params;
      this.Init(params);
    }
    
    Destroy() {
      this._params.group.remove(this._plane);
    }

    Hide() {
      this._plane.visible = false;
    }

    Show() {
      this._plane.visible = true;
    }

    Init(params) {
      const size = new THREE.Vector3(params.width, 0, params.width);

      let materials = [params.material, params.material2, params.material3, params.material4, params.material5, params.material6]
      let randomMaterial = materials[Math.floor(Math.random() * materials.length)]

      this._plane = new THREE.Mesh(
          new THREE.PlaneGeometry(size.x, size.z, params.resolution, params.resolution),
          randomMaterial);
      this._plane.castShadow = false;
      this._plane.receiveShadow = true;
      this._plane.rotation.x = -Math.PI / 2;
      this._params.group.add(this._plane);
    }

    GenerateHeight(v) {
      const offset = this._params.offset;
      const heightPairs = [];
      let normalization = 0;
      let z = 0;

      for (let gen of this._params.heightGenerators) {
        heightPairs.push(gen.Get(v.x + offset.x, -v.y + offset.y));
        normalization += heightPairs[heightPairs.length-1][1];
      }

      if (normalization > 0) {
        for (let h of heightPairs) {
          z += h[0] * h[1] / normalization;
        }
      }

      return z;
    }

    GenerateColor(x, y, z) {
      //TODO: GENERATE COLOR HERE

      let v = new THREE.Vector3(x, y, z)
      // console.log(v) //different from above (GenerateHeight) v

      // if (x < 600) return {r: 1, g: 0, b: 0.5}

      if (this._params.type == "GRASS") return {r: 0, g: 1, b: 0}

      return {r: 1, g: 1, b: 1}

    }

    *Rebuild() {//TODO figure out what yield means. if u can remove 2 instances of yield, u can remove the *
      const NUM_STEPS = 2000;
      const colours = [];
      const offset = this._params.offset;
      let count = 0;

      let pos = this._plane.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let v = new THREE.Vector3( pos.getX(i), pos.getY(i), pos.getZ(i) );

        this._plane.geometry.attributes.position.setXYZ(i, v.x, v.y, this.GenerateHeight(v))

        colours.push(this.GenerateColor(v.x + offset.x, v.z, -v.y + offset.y))

        // spread generation of terrain over multiple frames
        count++;
        if (count > NUM_STEPS) {
          count = 0;
          yield;
        }
      }

      yield;
      this._plane.geometry.elementsNeedUpdate = true;
      this._plane.geometry.verticesNeedUpdate = true;
      this._plane.geometry.computeVertexNormals();
      this._plane.position.set(offset.x, 0, offset.y);

    }

    GetPos() {
      return {x: this._plane.position.x, z: this._plane.position.z}
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
      let normalization = 1.0 - math.sat(
        (distance - this._radius[0]) / (this._radius[1] - this._radius[0]));
        normalization = normalization * normalization * (3 - 2 * normalization);
      
        let heightAtVertex = this._biomes.Height(x, y)
        
        return [heightAtVertex, normalization];
      }
    }
    
  return {
    TerrainChunkManager: TerrainChunkManager
  }
})();
