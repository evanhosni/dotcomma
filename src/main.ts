import * as THREE from "three";
import "./style.css";
import {terrain} from "./terrain"

class Dotcomma {
    private prevRAF: number | null = null;
    private minFrameTime = 0.1;
    private scene = new THREE.Scene();
    private renderer = new THREE.WebGLRenderer();
    private camera = new THREE.PerspectiveCamera(60, 1920 / 1080, 1, 25000); //TODO set values and make them accessible by other scripts
    private player = new THREE.Object3D();
    private entities: { [key: string]: any } = {}; //TODO rename entities to something that makes more sense
    // private stats = make stats thingy here, or add to entities more likely

    constructor() {
        this.Graphics();
        this.Camera();
        this.Lighting();
        this.Skybox();
        this.Terrain();
        this.Controls();
        this.Animate();
    }

    Graphics() {
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        const target = document.getElementById("[dotcomma]")!;
        target.appendChild(this.renderer.domElement);

        window.addEventListener(
            "resize",
            () => {
                this.camera.aspect = window.innerWidth / window.innerHeight;
                this.camera.updateProjectionMatrix();
                this.renderer.setSize(window.innerWidth, window.innerHeight);
            },
            false
        );
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
        let light = new THREE.DirectionalLight(0x808080, 1);
        light.position.set(-100, 100, -100);
        light.target.position.set(0, 0, 0);
        light.castShadow = false;
        this.scene.add(light);

        light = new THREE.DirectionalLight(0x404040, 1.5);
        light.position.set(100, 100, -100);
        light.target.position.set(0, 0, 0);
        light.castShadow = false;
        this.scene.add(light);
    }

    Skybox() {
        this.scene.background = new THREE.Color(0x000000);
    }

    Terrain() {
        this.entities["terrain"] = new terrain.TerrainChunkManager({
            scene: this.scene,
            camera: this.player,
        });
    }

    Controls() {
        // this.entities["controls"] = new controls.FPSControls({
        //     scene: this.scene,
        //     camera: this.player,
        // });
    }

    Animate() {
        requestAnimationFrame((t) => {
            if (this.prevRAF === null) {
                this.prevRAF = t;
            }
            this.Render(t - this.prevRAF);
            this.prevRAF = t;
        });
    }

    Render(timeInMS: number) {
        const timeInSeconds = Math.min(timeInMS * 0.001, this.minFrameTime);

        this.camera.position.copy(this.player.position);
        this.camera.quaternion.copy(this.player.quaternion);

        for (let k in this.entities) {
            this.entities[k].Update(timeInSeconds);
        }

        this.renderer.render(this.scene, this.camera);
        //TODO, you can update camera fov and stuff somewhere here

        this.Animate();
    }
}

new Dotcomma();
