import * as THREE from "three";

/**
 * Module-level cache for portal building assets (portal transforms, interior
 * template) so the expensive work is performed ONCE per building type rather
 * than once per instance.
 *
 * The spawn/despawn lag spike was almost entirely per-instance work:
 *   - interior scene deep-cloned every mount
 *   - new MeshStandardMaterial per mesh per mount (caused shader variants)
 *
 * With this cache, per-instance mount is just `interiorTemplate.clone(true)`,
 * which is cheap because geometries and materials are shared refs — only the
 * scene graph node hierarchy is duplicated.
 */

export interface PortalTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  /** [width, height] of the door opening in local units */
  size: [number, number];
  /** Door-shaped mesh in portal-local space; shared across all instances of this building type */
  geometry: THREE.BufferGeometry;
}

export interface BuildingAssets {
  portalData: { name: string; exterior: PortalTransform; interior: PortalTransform }[];
  /** Shared template — clone(true) produces cheap instances (materials + geometries shared) */
  interiorTemplate: THREE.Group;
  interiorBounds: { size: THREE.Vector3; center: THREE.Vector3 };
}

// Shared materials: one instance per material type, reused across every
// building. Critical for shader variant stability — with shared materials
// + stable light count (see IndoorLightRig), shaders compile once.
const EXTERIOR_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x707070, roughness: 0.85, metalness: 0.05 });
const INTERIOR_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.85, metalness: 0.05 });

const applyMaterial = (root: THREE.Object3D, material: THREE.Material, portalNames: Set<string>): void => {
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    if (portalNames.has(child.name)) {
      // Hide portal plane meshes — the Portal component renders its own visual
      child.visible = false;
    } else {
      (child as THREE.Mesh).material = material;
    }
  });
};

const extractPortalTransform = (scene: THREE.Group, name: string): PortalTransform | null => {
  const obj = scene.getObjectByName(name);
  if (!obj) return null;
  const mesh = obj as THREE.Mesh;
  if (!mesh.geometry) return null;

  scene.updateMatrixWorld(true);

  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);

  const normal = new THREE.Vector3(0, 0, 1);
  const normalAttr = mesh.geometry.getAttribute("normal");
  if (normalAttr) {
    normal.set(normalAttr.getX(0), normalAttr.getY(0), normalAttr.getZ(0));
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    normal.applyMatrix3(normalMatrix).normalize();
  }

  const yaw = Math.atan2(normal.x, normal.z);

  const height = size.y;
  const THIN = 0.5;
  let width: number;
  if (size.x < THIN) width = size.z;
  else if (size.z < THIN) width = size.x;
  else width = Math.max(size.x, size.z);

  // Re-express the door mesh in portal-local space (portal origin at door
  // center, +z along the door normal) so it can be rendered under the Portal
  // group's transform.
  const geometry = mesh.geometry.clone();
  const toPortalLocal = new THREE.Matrix4()
    .makeRotationY(-yaw)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
    .multiply(mesh.matrixWorld);
  geometry.applyMatrix4(toPortalLocal);

  return {
    position: [center.x, center.y, center.z],
    rotation: [0, yaw, 0],
    size: [width, height],
    geometry,
  };
};

const cache = new Map<string, BuildingAssets>();
const sourcesInitialized = new WeakSet<THREE.Group>();

/**
 * Return cached BuildingAssets for a given model pair, computing them on first
 * call. Caller is responsible for loading GLTFs (via useGLTF) and passing the
 * loaded scenes in. First call does the expensive work; subsequent calls are
 * O(1) lookups.
 */
export const getBuildingAssets = (
  exteriorKey: string,
  interiorKey: string,
  exteriorScene: THREE.Group,
  interiorScene: THREE.Group,
  portals: string[],
  extScale: number,
): BuildingAssets => {
  const cacheKey = `${exteriorKey}|${interiorKey}|${portals.join(",")}|${extScale}`;
  const existing = cache.get(cacheKey);
  if (existing) return existing;

  const portalNameSet = new Set(portals);

  // Apply shared materials to the GLTF source scenes (once per scene object).
  if (!sourcesInitialized.has(exteriorScene)) {
    applyMaterial(exteriorScene, EXTERIOR_MATERIAL, portalNameSet);
    sourcesInitialized.add(exteriorScene);
  }
  if (!sourcesInitialized.has(interiorScene)) {
    applyMaterial(interiorScene, INTERIOR_MATERIAL, portalNameSet);
    sourcesInitialized.add(interiorScene);
  }

  const portalData: BuildingAssets["portalData"] = [];
  for (const name of portals) {
    const ext = extractPortalTransform(exteriorScene, name);
    const int = extractPortalTransform(interiorScene, name);
    if (!ext || !int) continue;
    if (extScale !== 1) ext.geometry.scale(extScale, extScale, extScale);
    portalData.push({ name, exterior: ext, interior: int });
  }

  // Build interior template — a shared clone that per-instance clones copy
  // cheaply (node hierarchy only; materials + geometries are shared refs).
  const interiorTemplate = interiorScene.clone(true);
  for (const name of portals) {
    const obj = interiorTemplate.getObjectByName(name);
    if (obj) obj.visible = false;
  }

  interiorTemplate.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(interiorTemplate);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const assets: BuildingAssets = {
    portalData,
    interiorTemplate,
    interiorBounds: { size, center },
  };
  cache.set(cacheKey, assets);
  return assets;
};
