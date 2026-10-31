import * as THREE from "three";
import { instancedFromPoints, useChunkAssets, useWorldChunks, yawFromDir } from "..";
import { DressingAttributes } from "../../types";
import { enumerateDressing } from "../worker";
import { declare } from "../../../world/content";
import { featureMounts } from "../../../utils/workers/biomeFlags";
import { farthest } from "../utils";

const DEFAULT_RENDER_DISTANCE = 340;
const MARKER_HEIGHT = 0.16;

export interface RoadMarkersProps extends DressingAttributes {
  streetSpacing?: number;
  freewaySpacing?: number;
}

export const ROAD_MARKERS = "roadMarkers";

/** Raised studs down the middle of the roads of the biome this is mounted in, and of the runs
 *  leaving it — instead of a painted centerline, which shimmered against the quantized terrain. */
export const RoadMarkers = declare<RoadMarkersProps>({
  kind: ROAD_MARKERS,
  within: "biome",
  read: (node) => ({ ...node.props }),
  Driver: () => <RoadMarkersDriver />,
});

const RoadMarkersDriver = () => {
  const mounts = featureMounts<RoadMarkersProps>(ROAD_MARKERS);
  const resolvedDistance = farthest(mounts, "renderDistance", DEFAULT_RENDER_DISTANCE);
  const streetSpacing = mounts[0]?.params.streetSpacing ?? 9;
  const freewaySpacing = mounts[0]?.params.freewaySpacing ?? 11;

  const assets = useChunkAssets(() => {
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

  const groupRef = useWorldChunks({
    renderDistance: resolvedDistance,
    build: async (bounds) => {
      const points = await enumerateDressing("roadMarkers", bounds, { streetSpacing, freewaySpacing });
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
