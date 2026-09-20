import React from "react";
import * as THREE from "three";
import { instancedFromPoints, useDressingAssets, useDressingChunks, useDressingDefault, yawFromDir } from "../Dressing";
import { DressingAttributes } from "../../types";
import { getRoadMarkers } from "../dressingWorker";

const MARKER_HEIGHT = 0.16;

export interface RoadMarkersProps extends DressingAttributes {
  streetSpacing?: number;
  freewaySpacing?: number;
}

/** Studs instead of a painted centerline — paint shimmered against the quantized terrain. */
export const RoadMarkers = ({
  renderDistance,
  streetSpacing = 9,
  freewaySpacing = 11,
}: RoadMarkersProps) => {
  const resolvedDistance = useDressingDefault("renderDistance", renderDistance, 340);

  const assets = useDressingAssets(() => {
    // Top face pulled inward → a low frustum "turtle" (unlit, so no normal recompute).
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
        y: p.y + MARKER_HEIGHT * 0.35, // embedded in the road surface
        z: p.z,
        yaw: yawFromDir(p.dirX, p.dirZ),
      }));
    },
  });

  return <group ref={groupRef} />;
};
