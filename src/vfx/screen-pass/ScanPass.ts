/**
 * SCAN: the world as the thing scanning it sees — MAV vision. `<PostProcessing scan={0-1}>` and
 * devmode's "scan" sliders. Strength 0 = off, the pass skipped.
 *
 * The picture is pulled onto a two-stop phosphor palette by its LUMINANCE (a little of the scene's own
 * hue survives, so biomes stay apart under the grade), every silhouette the DEPTH buffer can find is
 * lit as a detected contour, a raster lies over it on pixel rows, and a vignette closes the corners.
 *
 * Contours come from depth, never from color: a scanner reports what is THERE, not what happens to be
 * dark. The depth step is RELATIVE (divided by the distance), so a beeble at 5u and a ridge 2km out
 * outline by the same rule — an absolute step outlines only what is close, and turns the whole middle
 * distance into a solid band.
 */
import * as THREE from "three";
import { SCREEN_QUAD_VERTEX_SHADER } from "./material";
import { ScreenFrame, ScreenPass } from "./types";
import { ScreenQuad } from "./ScreenQuad";
import { isScanning, SCAN } from "./store";

/** The palette's dark end — where weak signal sits — and its bright end, which is the contour's color too. */
const DARK: [number, number, number] = [0.03, 0.09, 0.11];
const HOT: [number, number, number] = [0.45, 1.0, 0.86];

/** What the depth texture's cleared value stands for; the sky must never read as a near surface. */
const SKY_DISTANCE = 60000;

const FRAGMENT_SHADER = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uStrength;
uniform vec4 uScan;    // grade, contour, raster, vignette
uniform vec3 uDark;
uniform vec3 uHot;
varying vec2 vUv;

float scanDistanceAt(vec2 uv) {
  float depth = texture2D(tDepth, uv).x;
  return depth >= 1.0 ? ${SKY_DISTANCE.toFixed(1)} : -perspectiveDepthToViewZ(depth, uNear, uFar);
}

void main() {
  vec2 px = vUv * uResolution;
  vec3 scene = texture2D(tColor, vUv).rgb;

  // The picture re-read as signal strength on the scanner's two stops.
  float lum = dot(scene, vec3(0.299, 0.587, 0.114));
  vec3 phosphor = mix(uDark, uHot, pow(clamp(lum, 0.0, 1.0), 0.75));
  phosphor = mix(phosphor, phosphor * (0.55 + scene * 1.3), 0.35);
  vec3 color = mix(scene, phosphor, uScan.x * uStrength);

  float here = scanDistanceAt(vUv);
  float left = scanDistanceAt(vUv - vec2(uTexel.x, 0.0));
  float right = scanDistanceAt(vUv + vec2(uTexel.x, 0.0));
  float down = scanDistanceAt(vUv - vec2(0.0, uTexel.y));
  float up = scanDistanceAt(vUv + vec2(0.0, uTexel.y));
  float relief = max(abs(left - right), abs(down - up)) / max(here, 1.0);
  color += uHot * smoothstep(0.008, 0.05, relief) * uScan.y * uStrength;

  // On PIXEL rows, so the raster never swims with the camera.
  color *= 1.0 - uScan.z * uStrength * (0.5 + 0.5 * sin(px.y * 3.14159265));

  float aspect = uResolution.x / max(1.0, uResolution.y);
  float corner = length((vUv - 0.5) * vec2(aspect, 1.0)) / 0.72;
  color *= 1.0 - uScan.w * uStrength * clamp(pow(corner, 2.4), 0.0, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
`;

export class ScanPass implements ScreenPass {
  private readonly quad = new ScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uStrength: { value: 0 },
        uScan: { value: new THREE.Vector4() },
        uDark: { value: new THREE.Vector3(...DARK) },
        uHot: { value: new THREE.Vector3(...HOT) },
      },
      vertexShader: SCREEN_QUAD_VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    }),
  );

  isActive(): boolean {
    return isScanning();
  }

  warm(gl: THREE.WebGLRenderer): void {
    this.quad.warm(gl);
  }

  render(gl: THREE.WebGLRenderer, frame: ScreenFrame, output: THREE.WebGLRenderTarget | null, camera: THREE.Camera): void {
    const u = this.quad.material.uniforms;
    const perspective = camera as THREE.PerspectiveCamera;
    u.tColor.value = frame.color;
    u.tDepth.value = frame.depth;
    u.uTexel.value.set(1 / frame.width, 1 / frame.height);
    u.uResolution.value.set(frame.width, frame.height);
    u.uNear.value = perspective.near;
    u.uFar.value = perspective.far;
    u.uStrength.value = SCAN.strength;
    u.uScan.value.set(SCAN.grade, SCAN.contour, SCAN.raster, SCAN.vignette);
    gl.setRenderTarget(output);
    this.quad.draw(gl);
  }

  dispose(): void {
    this.quad.dispose();
  }
}
