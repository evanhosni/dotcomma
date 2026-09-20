import { DressingAttributes } from "../../types";
import React from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { getActiveDomainConfig, whenDomainReady } from "../../../world/domains/utils";
import {
  DressingPartColliders,
  finalizeInstancedChunk,
  instancedFromPoints,
  setInstanceTransform,
  useChunkRegistry,
  useDressingAssets,
  useDressingChunks,
  useDressingColliders,
  DRESSING_COLLIDER_DISTANCE,
  useDressingDefault,
  yawFromDir,
} from "../Dressing";
import { CityFreewaySidePoint, getFreewaySidePoints } from "../dressingWorker";

import { ARM_DEPTH, ARM_HALF, ARM_THICKNESS, ARM_Y, POLE_COLLIDER_PARTS, POLE_HEIGHT, POLE_PLACEMENT } from "./poleSpec";

const WIRE_SEGMENTS = 3; // straight pieces faking the catenary sag per span
// Wire attach points as [y up the pole, z across it]: crossarm ends + top.
const WIRE_ATTACH_POINTS: [number, number][] = [
  [POLE_HEIGHT - 0.72, ARM_HALF - 0.25],
  [POLE_HEIGHT - 0.72, -(ARM_HALF - 0.25)],
  [POLE_HEIGHT - 0.05, 0],
];

interface PoleChunk {
  group: THREE.Group;
  points: { x: number; y: number; z: number }[];
}

export interface PowerLinesProps extends DressingAttributes {
  spacing?: number;
  /** Past the freeway edge. */
  lateralMargin?: number;
  /** Runs stop this close to interchanges. */
  junctionClear?: number;
}

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
      const sag = Math.min(3, span * 0.05);
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
    finalizeInstancedChunk(wires, min.x, min.y, min.z, max.x, max.y, max.z, 0.1); // 0.06u wire cross-section
  }
};

/** Each pole owns the wire span to its `next` point, so runs stay continuous across chunk borders. */
export const PowerLines = ({
  renderDistance,
  colliderDistance,
  spacing = POLE_PLACEMENT.spacing,
  lateralMargin = POLE_PLACEMENT.lateralMargin,
  junctionClear = POLE_PLACEMENT.junctionClear,
}: PowerLinesProps) => {
  const resolvedDistance = useDressingDefault("renderDistance", renderDistance, 420);
  const registry = useChunkRegistry<PoleChunk>();

  const assets = useDressingAssets(() => ({
    poleGeometry: mergeGeometries([
      new THREE.BoxGeometry(0.3, POLE_HEIGHT, 0.3).translate(0, POLE_HEIGHT / 2, 0),
      new THREE.BoxGeometry(ARM_THICKNESS, ARM_DEPTH, ARM_HALF * 2).translate(0, ARM_Y, 0),
    ]),
    // Unit piece along +X, scaled per segment.
    wireGeometry: new THREE.BoxGeometry(1, 0.06, 0.06).translate(0.5, 0, 0),
    poleMaterial: new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1, metalness: 0 }),
    // Unlit so wires read as silhouettes against the sky.
    wireMaterial: new THREE.MeshBasicMaterial({ color: 0x0e0e10 }),
  }));

  const groupRef = useDressingChunks({
    renderDistance: resolvedDistance,
    build: async (bounds) => {
      await whenDomainReady();
      const lateral = getActiveDomainConfig().cityConfig.freewayWidth + lateralMargin;
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
      ).filter((p) => p.side === POLE_PLACEMENT.side);
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
          spans.length * WIRE_ATTACH_POINTS.length * WIRE_SEGMENTS
        );
        fillWireSpans(wires, spans);
        group.add(wires);
      }
      registry.add({
        group,
        points: points.map((p) => ({ x: p.x, y: p.y, z: p.z, yaw: yawFromDir(p.dirX, p.dirZ) })),
      });
      return group;
    },
  });

  // Also owns the registry's prune sweep — PowerLines has no other frame loop.
  const colliders = useDressingColliders(registry, {
    colliderDistance: useDressingDefault("colliderDistance", colliderDistance, DRESSING_COLLIDER_DISTANCE),
  });

  return (
    <>
      <group ref={groupRef} />
      {/* Post + crossarm only; wires are deliberately not solid (poleSpec.ts). */}
      <DressingPartColliders colliders={colliders} parts={POLE_COLLIDER_PARTS} />
    </>
  );
};
