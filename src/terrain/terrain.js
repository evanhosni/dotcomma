// import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js';

import {noise} from '../engine/noise/noise.js';
import {math} from '../engine/math/math.js';

export const terrain = (function() {
  
  const _MIN_CELL_SIZE = 100;
  const _FIXED_GRID_SIZE = 10;
  const _MIN_CELL_RESOLUTION = 32;
  const _MIN_NODE_SIZE = 500;

  function DictIntersection(dictA, dictB) {
    const intersection = {};
    for (let k in dictB) {
      if (k in dictA) {
        intersection[k] = dictA[k];
      }
    }
    return intersection
  }

  function DictDifference(dictA, dictB) {
    const diff = {...dictA};
    for (let k in dictB) {
      delete diff[k];
    }
    return diff;
  }

  class QuadTree {
    constructor(params) {
      const b = new THREE.Box2(params.min, params.max);
      this._root = {
        bounds: b,
        children: [],
        center: b.getCenter(new THREE.Vector2()),
        size: b.getSize(new THREE.Vector2()),
      };
    }

    GetChildren() {
      const children = [];
      this._GetChildren(this._root, children);
      return children;
    }

    _GetChildren(node, target) {
      if (node.children.length == 0) {
        target.push(node);
        return;
      }

      for (let c of node.children) {
        this._GetChildren(c, target);
      }
    }

    Insert(pos) {
      this._Insert(this._root, new THREE.Vector2(pos.x, pos.z));
    }

    _Insert(child, pos) {
      const distToChild = this._DistanceToChild(child, pos);

      if (distToChild < child.size.x && child.size.x > _MIN_NODE_SIZE) {
        child.children = this._CreateChildren(child);

        for (let c of child.children) {
          this._Insert(c, pos);
        }
      }
    }

    _DistanceToChild(child, pos) {
      return child.center.distanceTo(pos);
    }

    _CreateChildren(child) {
      const midpoint = child.bounds.getCenter(new THREE.Vector2());

      // Bottom left
      const b1 = new THREE.Box2(child.bounds.min, midpoint);

      // Bottom right
      const b2 = new THREE.Box2(
        new THREE.Vector2(midpoint.x, child.bounds.min.y),
        new THREE.Vector2(child.bounds.max.x, midpoint.y));

      // Top left
      const b3 = new THREE.Box2(
        new THREE.Vector2(child.bounds.min.x, midpoint.y),
        new THREE.Vector2(midpoint.x, child.bounds.max.y));

      // Top right
      const b4 = new THREE.Box2(midpoint, child.bounds.max);

      const children = [b1, b2, b3, b4].map(
          b => {
            return {
              bounds: b,
              children: [],
              center: b.getCenter(new THREE.Vector2()),
              size: b.getSize(new THREE.Vector2())
            };
          });

      return children;
    }
  }

  class HeightGenerator {
    constructor(generator, position, minRadius, maxRadius) {
      this._position = position.clone();
      this._radius = [minRadius, maxRadius];
      this._generator = generator;
    }
  
    Get(x, y) {
      const distance = this._position.distanceTo(new THREE.Vector2(x, y));
      let normalization = 1.0 - math.sat(
          (distance - this._radius[0]) / (this._radius[1] - this._radius[0]));
      normalization = normalization * normalization * (3 - 2 * normalization);

      let heightAtVertex = this._generator.Get(x, y); //you created this variable

      //TODO: MODIFY HEIGHT HERE
      // if (x > 0) heightAtVertex = this._generator.Get(x, y) * 10;
      // if (x > -15 && x < 0) heightAtVertex = this._generator.Get(x, y) * (1 + (-1 / x));

      //END MODIFY HEIGHT

      return [heightAtVertex, normalization];
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

      this._plane = new THREE.Mesh(
          new THREE.PlaneGeometry(size.x, size.z, params.resolution, params.resolution),
          params.material);
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
      
      console.log(this._plane)

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
      // if (this._pool[w].length > 0) { // checks pool for existing version of chunk //TODO for some reason, pool gets fucked with new version of threejs
      //   c = this._pool[w].pop();
      //   c._params = params;
      // } else {
        c = new TerrainChunk(params);
      // }

      c.Hide();

      this._queued.push(c);

      return c;    
    }

    _RecycleChunks(chunks) {
      for (let c of chunks) {
        if (!(c.chunk._params.width in this._pool)) {
          this._pool[c.chunk._params.width] = [];
        }

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

    Update2() {
      for (let b of this._queued) {
        b._Rebuild().next();
        this._new.push(b);
      }
      this._queued = [];

      if (this._active) {
        return;
      }

      if (!this._queued.length) {
        this._RecycleChunks(this._old);
        for (let b of this._new) {
          b.Show();
        }
        this._Reset();
      }
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
        this._RecycleChunks(this._old); //send old chunks to object pool
        for (let b of this._new) {
          b.Show();
        }
        this._Reset();
      }
    }
  }

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
      this._builder = new TerrainChunkRebuilder();

      this._InitNoise(params);
      this._InitTerrain(params);
    }

    _InitNoise(params) {
      params.noise = {
        octaves: 6,
        persistence: 0.707,
        lacunarity: 1.8,
        exponentiation: 4.5,
        height: 300.0,
        scale: 1100.0,
        noiseType: 'simplex',
        seed: 1
      };

      this._noise = new noise.Noise(params.noise);

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
        type: "GRASS",
        group: this._group,
        material: this._material,
        width: width,
        offset: new THREE.Vector3(offset.x, offset.y, 0),
        resolution: _MIN_CELL_RESOLUTION,
        // biomeGenerator: this._biomes,
        // colourGenerator: new HyposemetricTints({biomeGenerator: this._biomes}),
        heightGenerators: [new HeightGenerator(this._noise, offset, 100000, 100000 + 1)],
      };

      return this._builder.AllocateChunk(params);
    }

    Update(_) {
      this._builder.Update();
      if (!this._builder.Busy) {
        this._UpdateVisibleChunks_Quadtree();
      }
    }

    _UpdateVisibleChunks_Quadtree() {
      function _Key(c) {
        return c.position[0] + '/' + c.position[1] + ' [' + c.dimensions[0] + ']';
      }

      const q = new QuadTree({
        min: new THREE.Vector2(-32000, -32000),
        max: new THREE.Vector2(32000, 32000),
      });
      q.Insert(this._params.camera.position);

      const children = q.GetChildren();

      let newTerrainChunks = {};
      const center = new THREE.Vector2();
      const dimensions = new THREE.Vector2();
      for (let c of children) {
        c.bounds.getCenter(center);
        c.bounds.getSize(dimensions);

        const child = {
          position: [center.x, center.y],
          bounds: c.bounds,
          dimensions: [dimensions.x, dimensions.y],
        };

        const k = _Key(child);
        newTerrainChunks[k] = child;
      }

      const intersection = DictIntersection(this._chunks, newTerrainChunks);
      const difference = DictDifference(newTerrainChunks, this._chunks); //compares list of terrain chunks to ones we already have
      const recycle = Object.values(DictDifference(this._chunks, newTerrainChunks));

      this._builder._old.push(...recycle);

      newTerrainChunks = intersection;

      for (let k in difference) {
        const [xp, zp] = difference[k].position;

        const offset = new THREE.Vector2(xp, zp);
        newTerrainChunks[k] = {
          position: [xp, zp],
          chunk: this._CreateTerrainChunk(offset, difference[k].dimensions[0]),
        };
      }

      this._chunks = newTerrainChunks;
    }

    _UpdateVisibleChunks_FixedGrid() {
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
      
      const difference = utils.DictDifference(keys, this._chunks);

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

    _UpdateVisibleChunks_Single() {
      function _Key(xc, zc) {
        return xc + '/' + zc;
      }

      // Check the camera's position.
      const [xc, zc] = this._CellIndex(this._params.camera.position);
      const newChunkKey = _Key(xc, zc);

      // We're still in the bounds of the previous chunk of terrain.
      if (newChunkKey in this._chunks) {
        return;
      }

      // Create a new chunk of terrain.
      const offset = new THREE.Vector2(xc * _MIN_CELL_SIZE, zc * _MIN_CELL_SIZE);
      this._chunks[newChunkKey] = {
        position: [xc, zc],
        chunk: this._CreateTerrainChunk(offset, _MIN_CELL_SIZE),
      };
    }
  }

  return {
    TerrainChunkManager: TerrainChunkManager
  }
})();
