import * as THREE from "three";
import { SCREEN_QUAD_VERTEX_SHADER, ScreenFrame, ScreenPass, ScreenQuad } from "./screenPass";

/**
 * TRACE: the frozen-desktop window trail. A HISTORY image (color + view distance) is kept on screen,
 * never reprojected; every `interval` seconds the current frame is STAMPED into it wherever it is nearer
 * than what the history holds there. So whatever moves across the screen (an object, or the whole view
 * when the camera turns) leaves a stack of crisp copies, one per stamp, and the live frame is drawn over
 * them by the same nearest-wins rule. Old copies RECEDE (their stored distance grows each stamp, slower
 * the higher the strength) until the scene behind overtakes them. Strength 0 = off, the pass skipped.
 */

/** Live values: <PostProcessing trace> sets the strength, devmode's sliders drive both (vfx/tuning.ts). */
export const TRACE = { strength: 0, interval: 0.05 };

export const isTracing = (): boolean => TRACE.strength > 0;

/** View distance stored for the sky and clamped for everything: RGBA16F holds ≤ 65504. */
const FAR_DISTANCE = 60000;

/** How fast a copy recedes, as its distance's growth per second: 1 holds a copy for many seconds, ~0 frees it at once. */
const recedeRate = (strength: number): number => 0.03 + 6 * (1 - strength) ** 3;

const FRAGMENT_SHADER = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tHistory;
uniform float uNear;
uniform float uFar;
uniform float uReset;
uniform float uStore;
uniform float uRecede;
varying vec2 vUv;

void main() {
  vec3 current = texture2D(tColor, vUv).rgb;
  float depth = texture2D(tDepth, vUv).x;
  float distance = depth >= 1.0 ? ${FAR_DISTANCE.toFixed(1)} : min(-perspectiveDepthToViewZ(depth, uNear, uFar), ${FAR_DISTANCE.toFixed(1)});
  vec4 history = texture2D(tHistory, vUv);
  // The tolerance lets the live frame win over its own stamped copy (half-float rounding) when nothing moved.
  bool currentWins = uReset > 0.5 || distance <= history.a * 1.002 + 0.02;
  vec3 color = currentWins ? current : history.rgb;
  float stored = currentWins ? distance : min(history.a * uRecede, ${FAR_DISTANCE.toFixed(1)});
  gl_FragColor = vec4(color, uStore > 0.5 ? stored : 1.0);
}
`;

/** Flagged like the chain's targets (screenPass.ts) so the quad's program is the screen's own; a
 *  half-float texture is never sRGB-encoded, so the flag changes nothing but the program key. */
const historyTarget = (w: number, h: number): THREE.WebGLRenderTarget => {
  const target = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, type: THREE.HalfFloatType });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  (target as any).isXRRenderTarget = true;
  return target;
};

export class TracePass implements ScreenPass {
  private readonly quad = new ScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        tHistory: { value: null },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uReset: { value: 0 },
        uStore: { value: 0 },
        uRecede: { value: 1 },
      },
      vertexShader: SCREEN_QUAD_VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    }),
  );
  private history: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private wasActive = false;
  private lastStamp = 0;

  isActive(): boolean {
    const active = isTracing();
    // Turned off, the next turn-on starts from a clean history instead of a stale screen.
    if (!active) this.wasActive = false;
    return active;
  }

  warm(gl: THREE.WebGLRenderer): void {
    this.quad.warm(gl);
  }

  render(gl: THREE.WebGLRenderer, frame: ScreenFrame, output: THREE.WebGLRenderTarget | null, camera: THREE.Camera, time: number): void {
    let reset = !this.wasActive;
    const sized = this.history && this.history[0].width === frame.width && this.history[0].height === frame.height;
    if (!sized) {
      this.disposeHistory();
      this.history = [historyTarget(frame.width, frame.height), historyTarget(frame.width, frame.height)];
      reset = true;
    }
    this.wasActive = true;

    const u = this.quad.material.uniforms;
    const perspective = camera as THREE.PerspectiveCamera;
    u.tColor.value = frame.color;
    u.tDepth.value = frame.depth;
    u.uNear.value = perspective.near;
    u.uFar.value = perspective.far;

    const elapsed = time - this.lastStamp;
    if (reset || elapsed >= TRACE.interval || elapsed < 0) {
      const [read, write] = this.history!;
      u.tHistory.value = read.texture;
      u.uReset.value = reset ? 1 : 0;
      u.uStore.value = 1;
      u.uRecede.value = (1 + recedeRate(TRACE.strength)) ** Math.max(0, elapsed);
      gl.setRenderTarget(write);
      this.quad.draw(gl);
      this.history = [write, read];
      this.lastStamp = time;
    }

    u.tHistory.value = this.history![0].texture;
    u.uReset.value = 0;
    u.uStore.value = 0;
    gl.setRenderTarget(output);
    this.quad.draw(gl);
  }

  private disposeHistory(): void {
    this.history?.[0].dispose();
    this.history?.[1].dispose();
    this.history = null;
  }

  dispose(): void {
    this.disposeHistory();
    this.quad.dispose();
  }
}
