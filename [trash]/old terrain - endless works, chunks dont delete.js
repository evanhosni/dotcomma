import {math} from '../engine/math/math.js';

import {biomes} from './biomes.js';

export const terrain = (function() {
  
  const _MIN_CELL_SIZE = 1600;
  const _FIXED_GRID_SIZE = 5;
  const _MIN_CELL_RESOLUTION = 16;

  class TerrainChunkManager {
    constructor(params) {
      this._Init(params);
    }

    
    _Init(params) {

      this._params = params;
      this._material = new THREE.MeshBasicMaterial({
        wireframe: true,
        wireframeLinewidth: 1,
        color: 0xFFFFFF,
        side: THREE.FrontSide,//don't know what this does
        // vertexColors: THREE.VertexColors,
      });
      this._material2 = new THREE.MeshBasicMaterial({//
        wireframe: true,//
        wireframeLinewidth: 1,//
        color: 0x00FFFF,//
        side: THREE.FrontSide,//
      });//
      this._material3 = new THREE.MeshBasicMaterial({//
        wireframe: true,//
        wireframeLinewidth: 1,//
        color: 0xFF00FF,//
        side: THREE.FrontSide,//
      });//
      this._material4 = new THREE.MeshBasicMaterial({//
        wireframe: true,//
        wireframeLinewidth: 1,//
        color: 0xFFFF00,//
        side: THREE.FrontSide,//
      });//
      this._material5 = new THREE.MeshBasicMaterial({//
        wireframe: true,//
        wireframeLinewidth: 1,//
        color: 0x0000FF,//
        side: THREE.FrontSide,//
      });//
      this._material6 = new THREE.MeshBasicMaterial({//
        wireframe: true,//
        wireframeLinewidth: 1,//
        color: 0xFF0000,//
        side: THREE.FrontSide,//
      });//
      this._builder = new TerrainChunkRebuilder();

      this._InitNoise(params);
      this._InitTerrain(params);
    }

    _InitNoise(params) {
      this._biomes = new biomes.Biomes(); //TODO: make this variable for different biomes, based on url extension or whatever its called

      params.heightmap = {
        height: 16,
      };
    }

    _InitTerrain(params) {
      params.terrain= {
        wireframe: false,
      };

      this._group = new THREE.Group()
      params.scene.add(this._group);

      this._chunks = {};
      this._params = params;
    }

    _CellIndex(p) {
      const xp = p.x + _MIN_CELL_SIZE * 0.5;
      const yp = p.z + _MIN_CELL_SIZE * 0.5;
      const x = Math.floor(xp / _MIN_CELL_SIZE);
      const z = Math.floor(yp / _MIN_CELL_SIZE);
      return [x, z];
    }

    _CreateTerrainChunk(offset, width) {
      const params = {
        group: this._group,
        material: this._material,
        material2: this._material2,//
        material3: this._material3,//
        material4: this._material4,//
        material5: this._material5,//
        material6: this._material6,//
        width: width,
        offset: new THREE.Vector3(offset.x, offset.y, 0),
        resolution: _MIN_CELL_RESOLUTION,
        // biomeGenerator: this._biomes,
        // colourGenerator: new HyposemetricTints({biomeGenerator: this._biomes}),
        heightGenerators: [new HeightGenerator(this._biomes, offset, 100000, 100000 + 1)],
      };

      return this._builder.AllocateChunk(params);
    }

    Update(/*_/*TODO this param _ isnt referenced anywhere*/) {
      this._builder.Update();
      if (!this._builder.Busy) {
        function _Key(xc, zc) {
          return xc + '/' + zc;
        }
  
        //figure out which terrain chunk we are in
        const [xc, zc] = this._CellIndex(this._params.camera.position);
  
        const keys = {};
  
        //generate all surrounding terrain chunks
        for (let x = -_FIXED_GRID_SIZE; x <= _FIXED_GRID_SIZE; x++) {
          for (let z = -_FIXED_GRID_SIZE; z <= _FIXED_GRID_SIZE; z++) {
            const k = _Key(x + xc, z + zc);
            keys[k] = {
              position: [x + xc, z + zc]
            };
          }
        }
        
        const difference = DictDifference(keys, this._chunks);
  
        for (let k in difference) {
          if (k in this._chunks) {
            continue;
          }
  
          const [xp, zp] = difference[k].position;
  
          const offset = new THREE.Vector2(xp * _MIN_CELL_SIZE, zp * _MIN_CELL_SIZE);
          this._chunks[k] = {
            position: [xc, zc],
            chunk: this._CreateTerrainChunk(offset, _MIN_CELL_SIZE),
          };
        }
      }
    }
  }

  class TerrainChunk {
    constructor(params) {
      this._params = params;
      this._Init(params);
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

    _Init(params) {
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

    _GenerateHeight(v) {
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

    _GenerateColor(x, y, z) {
      //TODO: GENERATE COLOR HERE

      let v = new THREE.Vector3(x, y, z)
      // console.log(v) //different from above (_GenerateHeight) v

      // if (x < 600) return {r: 1, g: 0, b: 0.5}

      if (this._params.type == "GRASS") return {r: 0, g: 1, b: 0}

      return {r: 1, g: 1, b: 1}

    }

    *_Rebuild() {
      const NUM_STEPS = 2000;
      const colours = [];
      const offset = this._params.offset;
      let count = 0;
      
      // console.log(this._plane)

      let pos = this._plane.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let v = new THREE.Vector3( pos.getX(i), pos.getY(i), pos.getZ(i) );

        this._plane.geometry.attributes.position.setXYZ(i, v.x, v.y, this._GenerateHeight(v))

        colours.push(this._GenerateColor(v.x + offset.x, v.z, -v.y + offset.y))

        // spread generation of terrain over multiple frames
        count++;
        if (count > NUM_STEPS) {
          count = 0;
          yield;
        }
      }

      // for (let f of this._plane.geometry.faces) {
      //   const vs = [f.a, f.b, f.c];

      //   const vertexColours = [];
      //   for (let v of vs) {
      //     vertexColours.push(colours[v]);
      //   }
      //   f.vertexColors = vertexColours;

      //   count++;
      //   if (count > NUM_STEPS) {
      //     count = 0;
      //     yield;
      //   }
      // }

      yield;
      this._plane.geometry.elementsNeedUpdate = true;
      this._plane.geometry.verticesNeedUpdate = true;
      this._plane.geometry.computeVertexNormals();
      this._plane.position.set(offset.x, 0, offset.y);
    }
  }

  //updates terrain based on camera location
  class TerrainChunkRebuilder {
    constructor(params) {
      this._pool = {};
      this._params = params;
      this._Reset();
    }

    // gives list of terrain chunks that need to be built
    AllocateChunk(params) {
      const w = params.width;

      if (!(w in this._pool)) {
        this._pool[w] = [];
      }

      let c = null;
      if (this._pool[w].length > 0) { // checks pool for existing version of chunk //TODO for some reason, pool gets fucked with new version of threejs
        c = this._pool[w].pop();
        c._params = params;
        // console.log("ye") //TODO: this is never reached
      } else {
        c = new TerrainChunk(params);
      }

      c.Hide();

      this._queued.push(c);

      return c;
    }

    _RecycleChunks(chunks) {
      for (let c of chunks) {
        if (!(c.chunk._params.width in this._pool)) {
          this._pool[c.chunk._params.width] = [];
        }
        console.log("recyc")
        c.chunk.Hide();
        this._pool[c.chunk._params.width].push(c.chunk); // sends old chunks to pool
      }
    }

    _Reset() {
      this._active = null;
      this._queued = [];
      this._old = [];
      this._new = [];
    }

    get Busy() {
      return this._active;
    }

    // spread creation of terrain chunks over multiple frames
    Update() {
      if (this._active) { // when one chunk is done,
        const r = this._active.next();
        if (r.done) {
          this._active = null;
        }
      } else { // start working on the next one
        const b = this._queued.pop();
        if (b) {
          this._active = b._Rebuild();
          this._new.push(b);
        }
      }

      if (this._active) {
        return;
      }

      if (!this._queued.length) { // once complete, swap old chunks and new chunks all at once, and new chunks appear
        console.log(this._old)
        this._RecycleChunks(this._old); //send old chunks to object pool
        for (let b of this._new) {
          b.Show();
        }
        this._Reset();
      }
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

  
  function DictDifference(dictA, dictB) {
    const diff = {...dictA};
    for (let k in dictB) {
      delete diff[k];
    }
    return diff;
  }
    
  return {
    TerrainChunkManager: TerrainChunkManager
  }
})();
