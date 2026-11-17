/**
 * INSPECT: the world with its devtools open. `<PostProcessing inspect={0-1}>` and devmode's "inspect"
 * sliders. Strength 0 = off, the pass skipped.
 *
 * Everything is an element. Silhouettes come back from the DEPTH buffer as the dashed 1px outlines an
 * inspector draws around a node — marching, so even a still screenshot reads as a live overlay — the
 * thing under the crosshair takes the selection fill, rulers run out from it to the edges of the
 * screen, and a faint layout grid sits under all of it.
 *
 * The outline is a RELATIVE depth step (divided by the distance), so a near beeble and a ridge 2km out
 * are outlined by the same rule and the horizon does not turn into a solid band. The selection is
 * everything at the crosshair's distance within reach of it on screen: a depth buffer has no notion of
 * which pixels belong to one object, and the screen-space reach is what keeps it to the thing looked at.
 */
import * as THREE from "three";
import { SCREEN_QUAD_VERTEX_SHADER } from "./material";
import { ScreenFrame, ScreenPass } from "./types";
import { ScreenQuad } from "./ScreenQuad";
import { INSPECT, isInspecting } from "./store";

/** The inspector's selection blue, and the fill on the element under the crosshair. */
const EDGE: [number, number, number] = [0.29, 0.62, 1.0];
const SELECT: [number, number, number] = [0.45, 0.72, 1.0];

/** What the depth texture's cleared value stands for; the sky is never selected and never outlined. */
const SKY_DISTANCE = 60000;

const FRAGMENT_SHADER = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uTime;
uniform float uStrength;
uniform vec3 uInspect;      // dash, gridPx, pickRadius
uniform vec3 uEdgeColor;
uniform vec3 uSelectColor;
varying vec2 vUv;

float inspectDistanceAt(vec2 uv) {
  float depth = texture2D(tDepth, uv).x;
  return depth >= 1.0 ? ${SKY_DISTANCE.toFixed(1)} : -perspectiveDepthToViewZ(depth, uNear, uFar);
}

void main() {
  vec2 px = vUv * uResolution;
  vec3 color = texture2D(tColor, vUv).rgb;

  float here = inspectDistanceAt(vUv);
  float left = inspectDistanceAt(vUv - vec2(uTexel.x, 0.0));
  float right = inspectDistanceAt(vUv + vec2(uTexel.x, 0.0));
  float down = inspectDistanceAt(vUv - vec2(0.0, uTexel.y));
  float up = inspectDistanceAt(vUv + vec2(0.0, uTexel.y));
  float relief = max(abs(left - right), abs(down - up)) / max(here, 1.0);
  float outline = smoothstep(0.010, 0.040, relief);
  // Marching ants along the screen diagonal.
  float ants = mix(1.0, step(0.42, fract((px.x + px.y) * 0.08 - uTime * 0.55)), uInspect.x);

  // THE LAYOUT GRID, under everything.
  if (uInspect.y > 1.0) {
    vec2 cell = abs(fract(px / uInspect.y) - 0.5) * uInspect.y;
    color = mix(color, uEdgeColor, (1.0 - smoothstep(0.0, 1.2, min(cell.x, cell.y))) * 0.10 * uStrength);
  }

  // THE SELECTION: whatever sits at the crosshair's distance, within reach of it on screen.
  float aspect = uResolution.x / max(1.0, uResolution.y);
  float center = inspectDistanceAt(vec2(0.5));
  float sameElement = 1.0 - smoothstep(0.02, 0.07, abs(here - center) / max(center, 1.0));
  float reach = 1.0 - smoothstep(uInspect.z * 0.45, uInspect.z, length((vUv - 0.5) * vec2(aspect, 1.0)));
  color = mix(color, uSelectColor, sameElement * reach * step(here, ${(SKY_DISTANCE - 1).toFixed(1)}) * 0.30 * uStrength);

  // THE RULERS out of the crosshair: an inspector's measurement guides.
  float ruler = smoothstep(1.6, 0.0, abs(px.x - uResolution.x * 0.5)) + smoothstep(1.6, 0.0, abs(px.y - uResolution.y * 0.5));
  color = mix(color, uEdgeColor, clamp(ruler, 0.0, 1.0) * 0.18 * ants * uStrength);

  // THE OUTLINE last: nothing draws over an element's border.
  color = mix(color, uEdgeColor, outline * ants * uStrength);

  gl_FragColor = vec4(color, 1.0);
}
`;

export class InspectPass implements ScreenPass {
  private readonly quad = new ScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uInspect: { value: new THREE.Vector3() },
        uEdgeColor: { value: new THREE.Vector3(...EDGE) },
        uSelectColor: { value: new THREE.Vector3(...SELECT) },
      },
      vertexShader: SCREEN_QUAD_VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    }),
  );

  isActive(): boolean {
    return isInspecting();
  }

  warm(gl: THREE.WebGLRenderer): void {
    this.quad.warm(gl);
  }

  render(gl: THREE.WebGLRenderer, frame: ScreenFrame, output: THREE.WebGLRenderTarget | null, camera: THREE.Camera, time: number): void {
    const u = this.quad.material.uniforms;
    const perspective = camera as THREE.PerspectiveCamera;
    u.tColor.value = frame.color;
    u.tDepth.value = frame.depth;
    u.uTexel.value.set(1 / frame.width, 1 / frame.height);
    u.uResolution.value.set(frame.width, frame.height);
    u.uNear.value = perspective.near;
    u.uFar.value = perspective.far;
    u.uTime.value = time;
    u.uStrength.value = INSPECT.strength;
    u.uInspect.value.set(INSPECT.dash, INSPECT.gridPx, INSPECT.pickRadius);
    gl.setRenderTarget(output);
    this.quad.draw(gl);
  }

  dispose(): void {
    this.quad.dispose();
  }
}
