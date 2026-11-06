import * as THREE from "three";

/** What a screen pass reads: the previous pass's color, and the SCENE's depth (no pass moves geometry). */
export interface ScreenFrame {
  color: THREE.Texture;
  depth: THREE.DepthTexture;
  width: number;
  height: number;
}

/** One full-screen effect in the chain. `render` draws into `output` (null = the screen), which the
 *  chain has already bound; a pass that draws elsewhere first binds `output` again before its last draw. */
export interface ScreenPass {
  isActive(): boolean;
  /** Links its programs now, not on first use. */
  warm(gl: THREE.WebGLRenderer): void;
  render(gl: THREE.WebGLRenderer, frame: ScreenFrame, output: THREE.WebGLRenderTarget | null, camera: THREE.Camera, time: number): void;
  dispose(): void;
}

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

export const SCREEN_QUAD_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Every chain target is flagged `isXRRenderTarget` with an sRGB texture: three keys a program by the
 * target's output color space and tone mapping, and a plain target would give every material a second
 * program, all linked on the first frame a pass turns on (the terrain's alone takes ~1s under ANGLE).
 * Flagged, every program is the screen's own; the sRGB8 storage hands the next pass back exactly what
 * the screen would have shown.
 */
const chainTarget = (w: number, h: number, withDepth: boolean): THREE.WebGLRenderTarget => {
  const target = new THREE.WebGLRenderTarget(w, h, { depthBuffer: withDepth });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  if (withDepth) target.depthTexture = new THREE.DepthTexture(w, h);
  (target as any).isXRRenderTarget = true;
  return target;
};

const _size = new THREE.Vector2();

/** The frame's post chain, in order. With no pass active the scene draws straight to the screen;
 *  otherwise into a target with depth, then through each active pass, ping-ponging to the screen. */
export class ScreenPassChain {
  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  private readonly pingPong: (THREE.WebGLRenderTarget | null)[] = [null, null];
  private readonly frame: ScreenFrame = { color: null!, depth: null!, width: 1, height: 1 };

  constructor(private readonly passes: readonly ScreenPass[]) {}

  warm(gl: THREE.WebGLRenderer): void {
    for (const pass of this.passes) pass.warm(gl);
  }

  private resize(gl: THREE.WebGLRenderer): void {
    gl.getDrawingBufferSize(_size);
    const w = Math.max(1, Math.floor(_size.x));
    const h = Math.max(1, Math.floor(_size.y));
    if (this.sceneTarget?.width === w && this.sceneTarget.height === h) return;
    this.disposeTargets();
    this.sceneTarget = chainTarget(w, h, true);
    this.pingPong[0] = chainTarget(w, h, false);
    this.pingPong[1] = chainTarget(w, h, false);
  }

  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    let activeCount = 0;
    for (const pass of this.passes) if (pass.isActive()) activeCount++;
    if (activeCount === 0) {
      gl.render(scene, camera);
      return;
    }
    this.resize(gl);
    const sceneTarget = this.sceneTarget!;
    gl.setRenderTarget(sceneTarget);
    gl.render(scene, camera);

    const frame = this.frame;
    frame.color = sceneTarget.texture;
    frame.depth = sceneTarget.depthTexture!;
    frame.width = sceneTarget.width;
    frame.height = sceneTarget.height;
    let drawn = 0;
    for (const pass of this.passes) {
      if (!pass.isActive()) continue;
      const output = ++drawn === activeCount ? null : this.pingPong[drawn % 2];
      gl.setRenderTarget(output);
      pass.render(gl, frame, output, camera, time);
      if (output) frame.color = output.texture;
    }
    gl.setRenderTarget(null);
  }

  private disposeTargets(): void {
    this.sceneTarget?.depthTexture?.dispose();
    this.sceneTarget?.dispose();
    this.pingPong[0]?.dispose();
    this.pingPong[1]?.dispose();
  }

  dispose(): void {
    this.disposeTargets();
    for (const pass of this.passes) pass.dispose();
  }
}
