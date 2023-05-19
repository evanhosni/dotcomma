import Stats from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/libs/stats.module.js';

import {controls} from './controls.js';
import {terrain} from './world/terrain.js';

var heyEvanDoYouWantTheStatsWindowVisible = true;

class dotcomma {
    constructor() {
        this.previousRAF = null;
        this.minFrameTime = 1.0 / 10.0;
        this.entities = {};

        this.Graphics()
        this.Camera()
        this.Lighting()
        this.Skybox()
        this.Terrain()
        this.Controls()
        this.Animate()
    }

    Graphics() {
        this.scene = new THREE.Scene();
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        const target = document.getElementById('[dotcomma]');
        target.appendChild(this.renderer.domElement);
        if (heyEvanDoYouWantTheStatsWindowVisible) {
            this.stats = new Stats();
            target.appendChild(this.stats.dom);
        }

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        }, false);
    }

    Camera() {
        const fov = 60;
        const aspect = 1920 / 1080;
        const near = 1;
        const far = 25000.0;
        this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
        this.camera.position.set(75, 10, 0);

        this.player = new THREE.Object3D();
        this.player.position.set(475, 75, 900);

        this.camera.position.copy(this.player.position);
    }

    Lighting() {
        let light = new THREE.DirectionalLight(0x808080, 1, 100);
        light.position.set(-100, 100, -100);
        light.target.position.set(0, 0, 0);
        light.castShadow = false;
        this.scene.add(light);

        light = new THREE.DirectionalLight(0x404040, 1.5, 100);
        light.position.set(100, 100, -100);
        light.target.position.set(0, 0, 0);
        light.castShadow = false;
        this.scene.add(light);
    }

    Skybox() {
        this.scene.background = new THREE.Color(0x000000);
    }

    Terrain() {
        this.entities['terrain'] = new terrain.TerrainChunkManager({
            camera: this.player,
            scene: this.scene,
            gui: this.gui,
            guiParams: this.guiParams,
        });
    }

    Controls() {
        this.entities['controls'] = new controls.FPSControls({
            scene: this.scene,
            camera: this.player
        });
    }

    Animate() {
        requestAnimationFrame((t) => {
            if (this.previousRAF === null) {
                this.previousRAF = t;
            }
            this.Render(t - this.previousRAF);
            this.previousRAF = t;
        });
    }

    Render(timeInMS) {
        const timeInSeconds = Math.min(timeInMS * 0.001, this.minFrameTime);

        this.camera.position.copy(this.player.position);
        this.camera.quaternion.copy(this.player.quaternion);

        for (let k in this.entities) {
            this.entities[k].Update(timeInSeconds);
        }

        this.renderer.render(this.scene, this.camera);
        if (heyEvanDoYouWantTheStatsWindowVisible) this.stats.update();

        this.Animate();
    }
}

new dotcomma();