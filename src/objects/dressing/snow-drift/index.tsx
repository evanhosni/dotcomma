import { traceSpan } from "../../../utils/spikeTrace";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { uploadOnFirstDraw } from "../../../utils/uploadOnFirstDraw";
import { meshTemplate } from "../../../utils/warmPrograms";
import type { SnowDriftMesh } from "../../../utils/workers/vertexCompute";
import { selfPatchedMaterial, type SolidDressingProps, useChunkAssets, useWorldChunks } from "..";
import { enumerateDressing } from "../worker";
import { createSnowMaterial } from "./material";
import { tickSnowTrail } from "./trail";
import { declare } from "../../../world/content";
import { featureMounts } from "../../../utils/workers/biomeFlags";
import { SNOW, SNOW_DEFAULTS } from "../../../utils/workers/snow/params";
import type { SnowParams } from "../../../utils/workers/types";
import { farthest } from "../utils";

/** Past LOD1's ring the terrain's own whitening carries the snow, so the sheet reaches a little past it. */
const DEFAULT_RENDER_DISTANCE = 440;

/** The chunk's one sheet (utils/workers/snow/snowDrift.ts getSnowDrift), relative to its center. */
const buildSheet = (sheet: SnowDriftMesh, material: THREE.Material): THREE.Mesh => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(sheet.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(sheet.normals, 3));
  geometry.setAttribute("depth", new THREE.BufferAttribute(sheet.depths, 1));
  geometry.setIndex(new THREE.BufferAttribute(sheet.indices, 1));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(sheet.x, 0, sheet.z);
  mesh.userData.ownsGeometry = true;
  uploadOnFirstDraw(mesh);
  return mesh;
};

/** The near SNOW sheet over the `snow: true` biomes: one continuous mesh per chunk on the drawn
 *  ground, cut along the smooth edge of where snow lies, dented where capsules walked (snowTrail.ts).
 *  No collider: the wading is the step's (physics). */
export interface SnowProps extends Pick<SolidDressingProps, "renderDistance">, Partial<SnowParams> {}

/** SNOW over the biome this is mounted in: it lies on the ground by height and slope, the terrain
 *  whitens under it, and capsules wade through it. One driver draws every mount. */
export const Snow = declare<SnowProps>({
  kind: SNOW,
  within: "biome",
  read: (node) => ({ ...SNOW_DEFAULTS, ...node.props }),
  Driver: () => <SnowDriver />,
});

const SnowDriver = () => {
  const mounts = featureMounts<SnowProps>(SNOW);
  const resolved = farthest(mounts, "renderDistance", DEFAULT_RENDER_DISTANCE);
  useFrame(({ clock }) => tickSnowTrail(clock.elapsedTime));
  const assets = useChunkAssets(
    () => ({ snow: selfPatchedMaterial(createSnowMaterial()) }),
    (a) => [meshTemplate(a.snow.material)],
  );
  const groupRef = useWorldChunks({
    renderDistance: resolved,
    build: async (bounds) => {
      const sheets = await enumerateDressing("snowDrift", bounds, {});
      if (sheets.length === 0) return null;
      const group = new THREE.Group();
      for (const sheet of sheets) group.add(traceSpan("snow:sheet", () => buildSheet(sheet, assets.snow.material)));
      return group;
    },
  });
  return <group ref={groupRef} />;
};
