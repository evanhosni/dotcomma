import * as THREE from "three";
import { reportContentError } from "../../utils/contentError";
import { SCREEN_QUAD_VERTEX_SHADER, ScreenFrame, ScreenPass, ScreenQuad } from "../screenPass";
import { DREAM_EDGE_FADE, DREAM_EDGE_SPILL, DREAM_FEEDBACK, DREAM_HEIGHT, DREAM_OVERSCAN, DREAM_STALE_AFTER, DREAM_WIDTH } from "./constants";
import { dreamStep, isDeepDreamReady, preloadDeepDream, startDeepDream } from "./worker";

/**
 * DEEP DREAM: Google's actual technique — gradient ascent on the image to excite a layer of a trained
 * image network (MobileNet v1 here, on a worker: deepDream.worker.ts) — made progressive. A dream takes
 * dozens of steps; a frame has time for none. So the dream ACCUMULATES: each worker request starts from
 * the previous dream, reprojected onto the current view through the depth buffer and the two cameras,
 * blended with a little of the fresh scene, and takes a couple more steps. Patterns grow over a second
 * or two and stay stuck to the world while the camera moves.
 *
 * The worker's answer lags the frame; that is fine, because the dream carries the camera it was taken
 * from and every frame reprojects it again. Reprojection reads the depth of what is on screen NOW, so
 * newly uncovered surfaces show the scene until the next step dreams on them.
 *
 * The dream is taken OVERSCANNED (wider than the screen; the off-screen part carried on from the previous
 * dream), its alpha says where it holds a dream, and its border fades within that off-screen margin: a
 * still camera shows the dream at full strength to the screen's edges, and a quick turn reveals a soft
 * edge a little later, never the hard rectangle of the view it was taken from.
 */

/** Live strength (0–1): how much of the dream is shown. 0 = off, nothing runs. */
export const DEEP_DREAM = { strength: 0 };

if (!(DREAM_OVERSCAN > 1)) reportContentError(`deep dream: DREAM_OVERSCAN must be > 1 (its margin holds the edge fade), got ${DREAM_OVERSCAN}`);

const OVERSCAN = DREAM_OVERSCAN.toFixed(4);
// Rounded DOWN: the band must never reach the screen's edge.
const EDGE_FADE = (Math.floor(DREAM_EDGE_FADE * 1e4) / 1e4).toFixed(4);

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tDream;
uniform mat4 uProjectionInverse;
uniform mat4 uCurrentToDream;
uniform mat4 uDreamProjection;
uniform float uHasDream;
uniform float uFeed;
uniform float uMix;
varying vec2 vUv;

// The dream image covers OVERSCAN × the screen's extent around the view it was taken from.
vec2 dreamToScreenUv(vec2 dreamUv) {
  return (dreamUv - 0.5) * ${OVERSCAN} + 0.5;
}

vec2 dreamUvOf(vec3 view, out float ahead) {
  vec4 clip = uDreamProjection * (uCurrentToDream * vec4(view, 1.0));
  ahead = step(0.0, clip.w);
  return clip.xy / clip.w * 0.5 + 0.5;
}

// The previous dream at a dream UV: rgb, and alpha = how much of it holds a dream (its own coverage,
// faded toward its border so its rectangle never shows; the band lies beyond the screen until a turn).
vec4 previousDream(vec2 dreamUv, float ahead) {
  vec2 edge = min(dreamUv, 1.0 - dreamUv);
  float fade = smoothstep(0.0, ${EDGE_FADE}, min(edge.x, edge.y)) * ahead;
  vec4 dream = texture2D(tDream, dreamUv);
  return vec4(dream.rgb, dream.a * fade * uHasDream);
}

vec3 viewAt(vec2 screenUv, float depth) {
  vec4 view = uProjectionInverse * vec4(screenUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return view.xyz / view.w;
}

void main() {
  float ahead;
  if (uFeed > 0.5) {
    // vUv is a texel of the overscanned feed: the scene under most of the previous dream. Off screen
    // there is no scene and no depth, so the screen's edge is extended (its colour and its depth, both
    // clamped): every texel follows ONE rule, continuous across the screen's edge. A rule that switched
    // there (pure previous dream outside, 8% fresh scene inside) handed the network a seam on the
    // screen's edge every request, and it dreamed it into a border fixed on screen.
    vec2 screenUv = dreamToScreenUv(vUv);
    vec2 clamped = clamp(screenUv, 0.0, 1.0);
    float outside = distance(screenUv, clamped);
    vec3 scene = texture2D(tColor, clamped).rgb;
    vec2 dreamUv = dreamUvOf(viewAt(screenUv, texture2D(tDepth, clamped).x), ahead);
    vec4 dream = previousDream(dreamUv, ahead);
    vec3 rgb = mix(scene, dream.rgb, dream.a * ${DREAM_FEEDBACK.toFixed(3)});
    // Coverage spills past the screen edge and fades: the streaked edge is dreamed on too, so a turn
    // reveals a gradient into the dream, never the line where the screen ended.
    float spill = 1.0 - smoothstep(0.0, ${DREAM_EDGE_SPILL.toFixed(3)}, outside);
    gl_FragColor = vec4(rgb, max(spill, dream.a));
    return;
  }
  // The dream itself, over the scene: at full strength it is what you see.
  vec3 scene = texture2D(tColor, vUv).rgb;
  vec2 dreamUv = dreamUvOf(viewAt(vUv, texture2D(tDepth, vUv).x), ahead);
  vec4 dream = previousDream(dreamUv, ahead);
  gl_FragColor = vec4(mix(scene, dream.rgb, uMix * dream.a), 1.0);
}
`;

/** Shrinks clip space so the dream camera sees DREAM_OVERSCAN × the screen's extent. */
const OVERSCAN_SCALE = new THREE.Matrix4().makeScale(1 / DREAM_OVERSCAN, 1 / DREAM_OVERSCAN, 1);

export class DeepDreamPass implements ScreenPass {
  private readonly quad = new ScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        tDream: { value: null },
        uProjectionInverse: { value: new THREE.Matrix4() },
        uCurrentToDream: { value: new THREE.Matrix4() },
        uDreamProjection: { value: new THREE.Matrix4() },
        uHasDream: { value: 0 },
        uFeed: { value: 0 },
        uMix: { value: 0 },
      },
      vertexShader: SCREEN_QUAD_VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    }),
  );

  /** The network's input: a plain (linear-storage) target, so readPixels returns the bytes as drawn. */
  private readonly feedTarget = new THREE.WebGLRenderTarget(DREAM_WIDTH, DREAM_HEIGHT, { depthBuffer: false });
  private dreamTexture: THREE.DataTexture | null = null;
  /** The camera the current dream was taken from (float64 on the CPU: absolute coordinates are fine here). */
  private readonly dreamView = new THREE.Matrix4();
  private readonly dreamProjection = new THREE.Matrix4();
  private readonly feedView = new THREE.Matrix4();
  private readonly feedProjection = new THREE.Matrix4();
  private busy = false;
  private lastDreamTime = -Infinity;
  private lastActiveTime = -Infinity;
  private disposed = false;

  isActive(): boolean {
    return DEEP_DREAM.strength > 0;
  }

  warm(gl: THREE.WebGLRenderer): void {
    preloadDeepDream();
    // Two programs: one keyed for the plain feed target, one for the chain's targets and the screen.
    gl.setRenderTarget(this.feedTarget);
    this.quad.warm(gl);
    gl.setRenderTarget(null);
    this.quad.warm(gl);
  }

  render(gl: THREE.WebGLRenderer, frame: ScreenFrame, output: THREE.WebGLRenderTarget | null, camera: THREE.Camera, time: number): void {
    // Off for a while (or off since a teleport): the old dream is from a camera too far away.
    if (time - this.lastActiveTime > DREAM_STALE_AFTER || time - this.lastDreamTime > DREAM_STALE_AFTER * 4) {
      this.lastDreamTime = -Infinity;
    }
    this.lastActiveTime = time;
    void startDeepDream();

    const hasDream = this.dreamTexture !== null && this.lastDreamTime > -Infinity;
    const u = this.quad.material.uniforms;
    u.tColor.value = frame.color;
    u.tDepth.value = frame.depth;
    u.tDream.value = this.dreamTexture;
    u.uProjectionInverse.value.copy(camera.projectionMatrixInverse);
    u.uCurrentToDream.value.multiplyMatrices(this.dreamView, camera.matrixWorld);
    u.uDreamProjection.value.copy(this.dreamProjection);
    u.uHasDream.value = hasDream ? 1 : 0;

    if (!this.busy && isDeepDreamReady()) {
      u.uFeed.value = 1;
      gl.setRenderTarget(this.feedTarget);
      this.quad.draw(gl);
      this.feedView.copy(camera.matrixWorldInverse);
      this.feedProjection.multiplyMatrices(OVERSCAN_SCALE, camera.projectionMatrix);
      this.request(gl, time);
    }

    u.uFeed.value = 0;
    u.uMix.value = DEEP_DREAM.strength;
    gl.setRenderTarget(output);
    this.quad.draw(gl);
  }

  private request(gl: THREE.WebGLRenderer, time: number): void {
    const width = DREAM_WIDTH;
    const height = DREAM_HEIGHT;
    this.busy = true;
    const view = this.feedView.clone();
    const projection = this.feedProjection.clone();
    gl.readRenderTargetPixelsAsync(this.feedTarget, 0, 0, width, height, new Uint8Array(width * height * 4))
      .then((pixels) => dreamStep(pixels as Uint8Array, width, height))
      .then((dreamed) => {
        if (this.disposed) return;
        this.upload(dreamed, width, height);
        this.dreamView.copy(view);
        this.dreamProjection.copy(projection);
        this.lastDreamTime = time;
      })
      .catch((err) => console.error("[deep dream]", err))
      .finally(() => (this.busy = false));
  }

  private upload(pixels: Uint8Array, width: number, height: number): void {
    const texture = this.dreamTexture;
    if (texture && texture.image.width === width && texture.image.height === height) {
      texture.image.data = pixels;
      texture.needsUpdate = true;
      return;
    }
    texture?.dispose();
    const next = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
    next.minFilter = THREE.LinearFilter;
    next.magFilter = THREE.LinearFilter;
    next.needsUpdate = true;
    this.dreamTexture = next;
  }

  dispose(): void {
    this.disposed = true;
    this.quad.dispose();
    this.feedTarget.dispose();
    this.dreamTexture?.dispose();
  }
}
