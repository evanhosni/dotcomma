import React from "react";
import * as THREE from "three";
import { instancedFromPoints, useDressingAssets, useDressingChunks, useDressingDefault, yawFromDir } from "../Dressing";
import { DressingAttributes } from "../../types";
import { getRoadMarkers } from "../dressingWorker";

const MARKER_HEIGHT = 0.16;

export interface RoadMarkersProps extends DressingAttributes {
  /** Marker spacing along street / freeway centerlines (world units). */
  streetSpacing?: number;
  freewaySpacing?: number;
}

/**
 * DRESSING: raised pavement markers along city road centerlines — small
 * unlit 3D studs instead of painted lines (paint shimmered against the
 * quantized terrain). Unlit yellow reads as retroreflective at night.
 */
export const RoadMarkers = ({
  renderDistance,
  streetSpacing = 9,
  freewaySpacing = 11,
}: RoadMarkersProps) => {
  const resolvedDistance = useDressingDefault("renderDistance", renderDistance, 340);

  const assets = useDressingAssets(() => {
    // Tapered stud: pull the top face's four vertices inward so the marker
    // reads as a low "turtle" dome (frustum) instead of a perfect box.
    // Material is unlit, so no normal recompute needed.
    const geometry = new THREE.BoxGeometry(0.6, MARKER_HEIGHT, 0.38);
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) {
        pos.setX(i, pos.getX(i) * 0.5);
        pos.setZ(i, pos.getZ(i) * 0.5);
      }
    }
    pos.needsUpdate = true;
    return { geometry, material: new THREE.MeshBasicMaterial({ color: "#c9a83e" }) };
  });

  const groupRef = useDressingChunks({
    renderDistance: resolvedDistance,
    build: async (bounds) => {
      const points = await getRoadMarkers(
        bounds.minX,
        bounds.minZ,
        bounds.maxX,
        bounds.maxZ,
        streetSpacing,
        freewaySpacing
      );
      if (points.length === 0) return null;
      return instancedFromPoints(assets.geometry, assets.material, points, (p) => ({
        x: p.x,
        y: p.y + MARKER_HEIGHT * 0.35, // slightly embedded
        z: p.z,
        yaw: yawFromDir(p.dirX, p.dirZ),
      }));
    },
  });

  return <group ref={groupRef} />;
};
