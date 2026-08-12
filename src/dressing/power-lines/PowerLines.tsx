import React from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { getActiveWorldConfig, whenWorldReady } from "../../world/registry";
import {
  instancedFromPoints,
  setInstanceTransform,
  useDressingAssets,
  useDressingChunks,
  useDressingRenderDistance,
  yawFromDir,
} from "../Dressing";
import { CityFreewaySidePoint, getFreewaySidePoints } from "../dressingWorker";

const POLE_HEIGHT = 11;
const ARM_HALF = 1.7; // crossarm half-length (perpendicular to the wires)
const WIRE_SEGMENTS = 3; // straight pieces faking the catenary sag per span
// Local attach points (y up the pole, z across it): crossarm ends + top.
const ATTACH: [number, number][] = [
  [POLE_HEIGHT - 0.72, ARM_HALF - 0.25],
  [POLE_HEIGHT - 0.72, -(ARM_HALF - 0.25)],
  [POLE_HEIGHT - 0.05, 0],
];

export interface PowerLinesProps {
  renderDistance?: number;
  /** Pole spacing along the freeway (world units). */
  spacing?: number;
  /** Pole line offset past the freeway edge — default lands on the sidewalk band. */
  lateralMargin?: number;
  /** Runs stop this close to interchanges. */
  junctionClear?: number;
}

/** Fill a wire InstancedMesh with the 3 wires × 3 sagging segments from each
 *  pole to its successor. Both ends' crossarm offsets use the POLE's frame —
 *  the next pole's tangent differs by at most a few degrees of wiggle,
 *  invisible at pole height. Also sets an explicit world-space bounding
 *  sphere from the span endpoints so frustum culling stays ON (the
 *  auto-computed instanced bounds only cover the unit wire geometry). */
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
  let w = 0;
  for (const p of spans) {
    const n = p.next!;
    const offX = -p.dirZ; // local +Z rotated into the world
    const offZ = p.dirX;
    for (const [ay, az] of ATTACH) {
      a.set(p.x + offX * az, p.y + ay, p.z + offZ * az);
      b.set(n.x + offX * az, n.y + ay, n.z + offZ * az);
      const span = a.distanceTo(b);
      const sag = Math.min(3, span * 0.05);
      for (let s = 0; s < WIRE_SEGMENTS; s++) {
        const t0 = s / WIRE_SEGMENTS;
        const t1 = (s + 1) / WIRE_SEGMENTS;
        pos.lerpVectors(a, b, t0);
        pos.y -= sag * 4 * t0 * (1 - t0);
        seg.lerpVectors(a, b, t1);
        seg.y -= sag * 4 * t1 * (1 - t1);
        // The rendered wire is the straight piece between the sampled points,
        // so the sampled points themselves ARE the geometry's extremes.
        min.min(pos).min(seg);
        max.max(pos).max(seg);
        seg.sub(pos);
        const len = seg.length();
        q.setFromUnitVectors(xAxis, seg.normalize());
        scale.set(len, 1, 1);
        setInstanceTransform(wires, w++, pos, q, scale);
      }
    }
  }
  wires.instanceMatrix.needsUpdate = true;
  if (w > 0) {
    // +0.1 pad for the 0.06u wire cross-section (mesh sits at the world
    // origin — instance positions are absolute, no further transform needed).
    wires.boundingSphere = new THREE.Sphere(
      min.clone().add(max).multiplyScalar(0.5),
      min.distanceTo(max) / 2 + 0.1
    );
  }
};

/**
 * DRESSING: utility poles with sagging wires along ONE side of every city
 * freeway (arterials + the belt ring). Each enumerated point carries its
 * successor's position, so every pole owns the wire span to the NEXT pole
 * and runs stay continuous across chunk borders; runs break naturally at
 * interchanges and street mouths. No colliders.
 */
export const PowerLines = ({
  renderDistance,
  spacing = 55,
  lateralMargin = 5,
  junctionClear = 26,
}: PowerLinesProps) => {
  const resolvedDistance = useDressingRenderDistance(renderDistance, 420);

  const assets = useDressingAssets(() => ({
    poleGeometry: mergeGeometries([
      new THREE.BoxGeometry(0.3, POLE_HEIGHT, 0.3).translate(0, POLE_HEIGHT / 2, 0), // pole
      new THREE.BoxGeometry(0.2, 0.25, ARM_HALF * 2).translate(0, POLE_HEIGHT - 0.85, 0), // crossarm
    ]),
    // Unit wire piece spanning 0..1 along +X — scaled per segment.
    wireGeometry: new THREE.BoxGeometry(1, 0.06, 0.06).translate(0.5, 0, 0),
    poleMaterial: new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1, metalness: 0 }),
    // Unlit near-black: wires read as silhouettes against the sky, day or night.
    wireMaterial: new THREE.MeshBasicMaterial({ color: 0x0e0e10 }),
  }));

  const groupRef = useDressingChunks({
    renderDistance: resolvedDistance,
    build: async (bounds) => {
      await whenWorldReady();
      const lateral = getActiveWorldConfig().cityConfig.freewayWidth + lateralMargin;
      const points = (
        await getFreewaySidePoints(
          bounds.minX,
          bounds.minZ,
          bounds.maxX,
          bounds.maxZ,
          spacing,
          lateral,
          junctionClear,
          true
        )
      ).filter((p) => p.side === 1); // one side of each freeway only
      if (points.length === 0) return null;

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
          spans.length * ATTACH.length * WIRE_SEGMENTS
        );
        fillWireSpans(wires, spans);
        group.add(wires);
      }
      return group;
    },
  });

  return <group ref={groupRef} />;
};
