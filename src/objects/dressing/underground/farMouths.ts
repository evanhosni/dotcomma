import * as THREE from "three";
import { AXIS_LIFT, MOUTH_RIM_AMP } from "../../../utils/workers/underground/constants";
import type { MouthPiece } from "../../../utils/workers/underground/types";
import { _curvature } from "../../../vfx/curvature";
import { uploadOnFirstDraw } from "../../../utils/uploadOnFirstDraw";
import { instancedTemplate, warmPrograms } from "../../../utils/warmPrograms";
import { LOD1_MAX_DISTANCE, LOD2_MAX_DISTANCE } from "../../../world/terrain/lodConfig";
import { fetchCaveMouths } from "./undergroundWorker";

/**
 * FAR MOUTHS: past its entrance a cave mouth is an IMPOSTOR, one instanced disc per mouth standing in
 * the opening and facing out of the tunnel — the same at every terrain LOD — pulled toward the camera
 * so coarse ground in front of an opening never covers it. Its strength is the complement of the
 * entrance fade (complementary pixels), so the entrance dithers in over it. Mouths come from the tunnel
 * worker (caves are generated there anyway) within the draw distance plus the LOD1 ring, re-fetched
 * after that much travel.
 */

const MAX_FAR_MOUTHS = 64;
/** Drawn to here, dithering out from FADE_START. */
const FAR_MOUTH_DISTANCE = LOD2_MAX_DISTANCE * 0.75;
const FADE_START = FAR_MOUTH_DISTANCE * 0.8;
const FETCH_REACH = FAR_MOUTH_DISTANCE + LOD1_MAX_DISTANCE;
const REFETCH_TRAVEL = LOD1_MAX_DISTANCE;
const OPACITY = 0.75;
/** The disc spreads this many opening radii. */
const SPREAD = 1.35;
/** The solid core's share of the radius, and how far up the radius it sits. */
const CORE_SHARE = 0.35;
const CORE_LIFT = 0.12;
const CORE_GRAY = 0.012;
const RIM_GRAY = 0.08;
/** Pulled toward the camera by this share of its distance, within [PULL_MIN, PULL_MAX]. */
const PULL_SHARE = 0.006;
const PULL_MIN = 0.5;
const PULL_MAX = 12;

interface FarMouthState {
  scene: THREE.Scene | null;
  mesh: THREE.InstancedMesh | null;
  strength: THREE.InstancedBufferAttribute | null;
  mouths: MouthPiece[];
  fetchedAt: { x: number; z: number } | null;
  fetching: boolean;
  originX: number;
  originZ: number;
}

const state: FarMouthState = { scene: null, mesh: null, strength: null, mouths: [], fetchedAt: null, fetching: false, originX: 0, originZ: 0 };

const createMaterial = (): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: { uCurveStart: _curvature.uniforms.uCurveStart, uCurveK: _curvature.uniforms.uCurveK },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aStrength;
      varying vec2 vUv;
      varying float vStrength;
      ${_curvature.CURVE_GLSL}
      void main() {
        vUv = uv;
        vStrength = aStrength;
        // The disc's center and its world position relative to the rebase origin (modelMatrix[3]).
        vec3 center = instanceMatrix[3].xyz;
        vec3 origin = modelMatrix[3].xyz;
        vec3 toCamera = cameraPosition - (origin + center);
        float dist = length(toCamera);
        vec3 pull = toCamera / max(dist, 1e-3) * clamp(dist * ${PULL_SHARE.toFixed(4)}, ${PULL_MIN.toFixed(2)}, ${PULL_MAX.toFixed(2)});
        vec3 local = (instanceMatrix * vec4(position, 1.0)).xyz + pull;
        vec3 viewPos = modelViewMatrix[3].xyz + mat3(viewMatrix) * local;
        gl_Position = projectionMatrix * vec4(curveViewPos(viewPos), 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vStrength;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p - vec2(0.0, ${CORE_LIFT.toFixed(3)}));
        float core = 1.0 - smoothstep(${CORE_SHARE.toFixed(3)}, 1.0, r);
        float gray = mix(${RIM_GRAY.toFixed(3)}, ${CORE_GRAY.toFixed(3)}, core);
        float alpha = ${OPACITY.toFixed(2)} * vStrength * (1.0 - smoothstep(${CORE_SHARE.toFixed(3)}, 1.0, length(p)));
        if (alpha <= 0.002) discard;
        gl_FragColor = vec4(vec3(gray), alpha);
      }
    `,
  });

/** Mounts the impostor mesh in the scene (the `<Caves/>` mount), its program warmed at load; returns the unmount. */
export const mountFarMouths = (scene: THREE.Scene): (() => void) => {
  if (!state.mesh) {
    const geometry = new THREE.InstancedBufferGeometry();
    const disc = new THREE.CircleGeometry(1, 24);
    geometry.setIndex(disc.getIndex());
    geometry.setAttribute("position", disc.getAttribute("position"));
    geometry.setAttribute("uv", disc.getAttribute("uv"));
    const strength = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FAR_MOUTHS), 1);
    strength.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aStrength", strength);
    const mesh = new THREE.InstancedMesh(geometry, createMaterial(), MAX_FAR_MOUTHS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.count = 0;
    uploadOnFirstDraw(mesh);
    state.mesh = mesh;
    state.strength = strength;
  }
  state.scene = scene;
  scene.add(state.mesh);
  const cancelWarm = warmPrograms(scene, [instancedTemplate(state.mesh.material as THREE.Material)]);
  return () => {
    cancelWarm();
    state.mesh?.removeFromParent();
    state.scene = null;
  };
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _look = new THREE.Vector3();
const _forward = new THREE.Vector3(0, 0, 1);

/** Every frame: fetches the mouths in reach when the camera has travelled, and writes the nearest
 *  MAX_FAR_MOUTHS discs with their strengths (1 − the entrance fade). */
export const driveFarMouths = (camera: THREE.Camera, fadeOf: (id: string) => number): void => {
  const mesh = state.mesh;
  if (!mesh || !state.scene) return;
  const { x, z } = camera.position;
  const far = state.fetchedAt === null || Math.hypot(x - state.fetchedAt.x, z - state.fetchedAt.z) > REFETCH_TRAVEL;
  if (far && !state.fetching) {
    state.fetching = true;
    const at = { x, z };
    fetchCaveMouths({ minX: x - FETCH_REACH, minZ: z - FETCH_REACH, maxX: x + FETCH_REACH, maxZ: z + FETCH_REACH })
      .then((mouths) => {
        state.mouths = mouths;
        state.fetchedAt = at;
      })
      .finally(() => {
        state.fetching = false;
      });
  }
  // Rebased on the camera's position at the last fetch: everything is within FETCH_REACH of it.
  if (state.fetchedAt && (state.originX !== state.fetchedAt.x || state.originZ !== state.fetchedAt.z)) {
    state.originX = state.fetchedAt.x;
    state.originZ = state.fetchedAt.z;
    mesh.position.set(state.originX, 0, state.originZ);
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
  }
  // The nearest MAX_FAR_MOUTHS within the draw distance, by an index sort over scratch arrays (every
  // frame: no lists are built).
  const mouths = state.mouths;
  if (_distance.length < mouths.length) {
    _distance = new Float64Array(mouths.length);
    _order = new Int32Array(mouths.length);
  }
  let shown = 0;
  for (let i = 0; i < mouths.length; i++) {
    const d = Math.hypot(mouths[i].ox - x, mouths[i].oz - z);
    _distance[i] = d;
    if (d < FAR_MOUTH_DISTANCE) _order[shown++] = i;
  }
  const order = _order.subarray(0, shown).sort(_byDistance);
  if (shown > MAX_FAR_MOUTHS) shown = MAX_FAR_MOUTHS;
  const strength = state.strength!;
  for (let i = 0; i < shown; i++) {
    const m = mouths[order[i]];
    const d = _distance[order[i]];
    const r = m.r0 * (1 + MOUTH_RIM_AMP) * SPREAD;
    _p.set(m.ox - state.originX, m.oy + AXIS_LIFT * m.r0, m.oz - state.originZ);
    // Facing out of the tunnel: the disc's +z toward −d.
    _look.set(-m.dx, 0, -m.dz);
    _q.setFromUnitVectors(_forward, _look);
    _s.set(r, r, 1);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
    const fadeOut = 1 - Math.min(1, Math.max(0, (d - FADE_START) / (FAR_MOUTH_DISTANCE - FADE_START)));
    strength.setX(i, (1 - fadeOf(m.id)) * fadeOut);
  }
  mesh.count = shown;
  mesh.instanceMatrix.needsUpdate = true;
  strength.needsUpdate = true;
};
let _distance = new Float64Array(0);
let _order = new Int32Array(0);
const _byDistance = (a: number, b: number): number => _distance[a] - _distance[b];

/** A domain reset: the fetched mouths belong to the old world. */
export const resetFarMouths = (): void => {
  state.mouths = [];
  state.fetchedAt = null;
  if (state.mesh) state.mesh.count = 0;
};
