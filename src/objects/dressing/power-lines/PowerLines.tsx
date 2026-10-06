import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import {
  finalizeInstancedChunk,
  instancedFromPoints,
  setInstanceTransform,
  type SolidDressingProps,
  useDressingAssets,
  useSolidDressing,
  yawFromDir,
} from "../Dressing";
import type { CityFreewaySidePoint } from "../../../utils/workers/vertexCompute";
import {
  CROSSARM_DEPTH,
  CROSSARM_HALF_LENGTH,
  CROSSARM_THICKNESS,
  CROSSARM_Y,
  POWER_LINES_SPEC,
  UTILITY_POLE_HEIGHT,
} from "./poleSpec";

const DEFAULT_RENDER_DISTANCE = 420;
const WIRE_SEGMENTS = 3; // straight pieces faking the catenary sag per span
const WIRE_SAG_PER_LENGTH = 0.05; // midspan drop per unit of span length …
const WIRE_MAX_SAG = 3; // … capped here
/** Wire cross-section 0.06u, rounded up. */
const WIRE_BOUNDS_PAD = 0.1;
// Wire attach points as [y up the pole, z across it]: crossarm ends + top.
const WIRE_ATTACH_POINTS: [number, number][] = [
  [UTILITY_POLE_HEIGHT - 0.72, CROSSARM_HALF_LENGTH - 0.25],
  [UTILITY_POLE_HEIGHT - 0.72, -(CROSSARM_HALF_LENGTH - 0.25)],
  [UTILITY_POLE_HEIGHT - 0.05, 0],
];

/** Both ends' crossarm offsets use the starting pole's frame — the next pole's tangent differs
 *  by a few degrees of wiggle at most, invisible at pole height. */
const fillWireSpans = (wires: THREE.InstancedMesh, spans: CityFreewaySidePoint[]): void => {
  const xAxis = new THREE.Vector3(1, 0, 0);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const seg = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let instanceIndex = 0;
  for (const p of spans) {
    const n = p.next!;
    const offX = -p.dirZ; // local +Z in world
    const offZ = p.dirX;
    for (const [ay, az] of WIRE_ATTACH_POINTS) {
      a.set(p.x + offX * az, p.y + ay, p.z + offZ * az);
      b.set(n.x + offX * az, n.y + ay, n.z + offZ * az);
      const span = a.distanceTo(b);
      const sag = Math.min(WIRE_MAX_SAG, span * WIRE_SAG_PER_LENGTH);
      for (let s = 0; s < WIRE_SEGMENTS; s++) {
        const t0 = s / WIRE_SEGMENTS;
        const t1 = (s + 1) / WIRE_SEGMENTS;
        pos.lerpVectors(a, b, t0);
        pos.y -= sag * 4 * t0 * (1 - t0);
        seg.lerpVectors(a, b, t1);
        seg.y -= sag * 4 * t1 * (1 - t1);
        min.min(pos).min(seg);
        max.max(pos).max(seg);
        seg.sub(pos);
        const len = seg.length();
        q.setFromUnitVectors(xAxis, seg.normalize());
        scale.set(len, 1, 1);
        setInstanceTransform(wires, instanceIndex++, pos, q, scale);
      }
    }
  }
  wires.instanceMatrix.needsUpdate = true;
  if (instanceIndex > 0) {
    finalizeInstancedChunk(wires, min.x, min.y, min.z, max.x, max.y, max.z, WIRE_BOUNDS_PAD);
  }
};

/** Each pole owns the wire span to its `next` point, so runs stay continuous across chunk borders.
 *  Placement lives in poleSpec.ts only (the server builds the colliders from it). */
export const PowerLines = ({ renderDistance, colliderDistance }: SolidDressingProps) => {
  const assets = useDressingAssets(() => ({
    poleGeometry: mergeGeometries([
      new THREE.BoxGeometry(0.3, UTILITY_POLE_HEIGHT, 0.3).translate(0, UTILITY_POLE_HEIGHT / 2, 0),
      new THREE.BoxGeometry(CROSSARM_THICKNESS, CROSSARM_DEPTH, CROSSARM_HALF_LENGTH * 2).translate(0, CROSSARM_Y, 0),
    ]),
    // Unit piece along +X, scaled per segment.
    wireGeometry: new THREE.BoxGeometry(1, 0.06, 0.06).translate(0.5, 0, 0),
    poleMaterial: new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1, metalness: 0 }),
    // Unlit so wires read as silhouettes against the sky.
    wireMaterial: new THREE.MeshBasicMaterial({ color: 0x0e0e10 }),
  }));

  // Post + crossarm colliders only; wires are deliberately not solid (poleSpec.ts).
  const { content } = useSolidDressing(POWER_LINES_SPEC, {
    requestExtras: { withNext: true },
    renderDistance,
    defaultRenderDistance: DEFAULT_RENDER_DISTANCE,
    colliderDistance,
    build: (points) => {
      const poles = instancedFromPoints(assets.poleGeometry, assets.poleMaterial, points, (p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: yawFromDir(p.dirX, p.dirZ),
      }));

      const group = new THREE.Group();
      group.add(poles);
      const spans = points.filter((p) => p.next);
      if (spans.length > 0) {
        const wires = new THREE.InstancedMesh(
          assets.wireGeometry,
          assets.wireMaterial,
          spans.length * WIRE_ATTACH_POINTS.length * WIRE_SEGMENTS
        );
        fillWireSpans(wires, spans);
        group.add(wires);
      }
      return { group };
    },
  });

  return content;
};
