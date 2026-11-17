import * as THREE from "three";

/** A pass's full-screen quad: one material, drawn with an orthographic camera. */
export class ScreenQuad {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(readonly material: THREE.ShaderMaterial) {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  draw(gl: THREE.WebGLRenderer): void {
    gl.render(this.scene, this.camera);
  }

  warm(gl: THREE.WebGLRenderer): void {
    gl.compile(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
  }
}
