// import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js';
import {controls} from './controls.js';
import {graphics} from './graphics.js';
import {terrain} from './terrain/terrain.js';


let _APP = null;

class ProceduralTerrain_Demo {
  constructor() {
    this._Initialize();
  }

  _Initialize() {
    this._graphics = new graphics.Graphics(this);
    if (!this._graphics.Initialize()) {
      this._DisplayError('WebGL2 is not available.');
      return;
    }

    this._previousRAF = null;
    this._minFrameTime = 1.0 / 10.0;
    this._entities = {};

    this._OnInitialize();
    this._RAF();
  }

  _DisplayError(errorText) {
    const error = document.getElementById('error');
    error.innerText = errorText;
  }

  _RAF() {
    requestAnimationFrame((t) => {
      if (this._previousRAF === null) {
        this._previousRAF = t;
      }
      this._Render(t - this._previousRAF);
      this._previousRAF = t;
    });
  }

  _StepEntities(timeInSeconds) {
    for (let k in this._entities) {
      this._entities[k].Update(timeInSeconds);
    }
  }

  _Render(timeInMS) {
    const timeInSeconds = Math.min(timeInMS * 0.001, this._minFrameTime);

    this._OnStep(timeInSeconds);
    this._StepEntities(timeInSeconds);
    this._graphics.Render(timeInSeconds);

    this._RAF();
  }

  _OnInitialize() {

    this._userCamera = new THREE.Object3D();
    this._userCamera.position.set(475, 75, 900);

    this._entities['_terrain'] = new terrain.TerrainChunkManager({
      camera: this._userCamera,
      scene: this._graphics.Scene,
      gui: this._gui,
      guiParams: this._guiParams,
    });

    this._entities['_controls'] = new controls.FPSControls(
      {
        scene: this._graphics.Scene,
        camera: this._userCamera
      });

    this._graphics.Camera.position.copy(this._userCamera.position);

    this._LoadBackground();
  }

  _LoadBackground() {
    this._graphics.Scene.background = new THREE.Color(0x000000);
  }

  _OnStep(_) {
    this._graphics._camera.position.copy(this._userCamera.position);
    this._graphics._camera.quaternion.copy(this._userCamera.quaternion);
  }
}


function _Main() {
  _APP = new ProceduralTerrain_Demo();
}

_Main();
