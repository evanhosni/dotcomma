import * as THREE from "three";
import { smoothstep } from "../../../utils/math/_math";

/** HAND-BUILT overworld thumbnail for the CRT (grass | city | desert
 *  cross-section), baked once — none of the real generation pipeline. */

const RES = 64; // the thumbnail's pixelation IS this number

/** The city's block lattice: towers at x≡0 / z≡9, roads between them at x≡9 / z≡0 (mod BLOCK_PITCH). */
const BLOCK_PITCH = 18;
const ROAD_HALF_WIDTH = 2.5;

let cached: THREE.Texture | null = null;

const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Distance from v to the nearest lattice line (multiples of BLOCK_PITCH, offset o). */
const lineDist = (v: number, o: number): number => {
  const m = (((v - o) % BLOCK_PITCH) + BLOCK_PITCH) % BLOCK_PITCH;
  return Math.min(m, BLOCK_PITCH - m);
};

/** The vertex-colored ground: grass < -30 < city < 30 < desert, soft borders, hills and dunes. */
const createGround = (): THREE.Mesh => {
  const W = 240;
  const D = 170;
  const geo = new THREE.PlaneGeometry(W, D, 48, 34);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const grass = new THREE.Color("#3f7a2c");
  const sand = new THREE.Color("#c2a36b");
  const plaza = new THREE.Color("#8a8a8a");
  const asphalt = new THREE.Color("#3a3a3a");

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    const desertW = smoothstep(22, 42, x);
    const grassW = 1 - smoothstep(-42, -22, x);
    const cityW = 1 - grassW - desertW;

    const hills = Math.max(0, 5 + 6 * (Math.sin(x * 0.055) * Math.cos(z * 0.07) + 0.5 * Math.sin(x * 0.11 + 1.7)));
    const dunes = Math.max(0, 4 + 5 * (Math.sin(x * 0.06 + z * 0.045) + 0.5 * Math.sin(z * 0.1 + 2)));
    pos.setY(i, grassW * hills + desertW * dunes);

    const onRoad = lineDist(x, 9) < ROAD_HALF_WIDTH || lineDist(z, 0) < ROAD_HALF_WIDTH;
    const cityGround = onRoad ? asphalt : plaza;

    const jitter = 0.85 + 0.3 * hash(x, z);
    c.setRGB(
      (grass.r * grassW + cityGround.r * cityW + sand.r * desertW) * jitter,
      (grass.g * grassW + cityGround.g * cityW + sand.g * desertW) * jitter,
      (grass.b * grassW + cityGround.b * cityW + sand.b * desertW) * jitter
    );
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
};

/** Gray towers of seeded heights on the city's lots (some left empty). */
const createTowers = (): THREE.Mesh[] => {
  const towers: THREE.Mesh[] = [];
  for (const bx of [-BLOCK_PITCH, 0, BLOCK_PITCH]) {
    for (let bz = -63; bz <= 63; bz += BLOCK_PITCH) {
      const roll = hash(bx, bz);
      if (roll < 0.3) continue; // empty lot
      const h = 7 + roll * 26;
      const shade = 0.3 + 0.45 * hash(bz, bx);
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(11, h, 11),
        new THREE.MeshLambertMaterial({ color: new THREE.Color(shade, shade, shade) }),
      );
      tower.position.set(bx, h / 2, bz);
      towers.push(tower);
    }
  }
  return towers;
};

export const getDomainDioramaTexture = (gl: THREE.WebGLRenderer): THREE.Texture => {
  if (cached) return cached;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0620");
  scene.fog = new THREE.Fog("#0b0620", 140, 330);

  const sun = new THREE.DirectionalLight("#ffe9c4", 2.4);
  sun.position.set(60, 90, 50);
  scene.add(sun, new THREE.AmbientLight("#7788dd", 0.55));

  const meshes = [createGround(), ...createTowers()];
  scene.add(...meshes);

  const camera = new THREE.PerspectiveCamera(50, 1, 1, 1000);
  camera.position.set(0, 46, 150);
  camera.lookAt(0, 0, -10);

  const rt = new THREE.WebGLRenderTarget(RES, RES, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  const prevTarget = gl.getRenderTarget();
  gl.setRenderTarget(rt);
  gl.render(scene, camera);
  gl.setRenderTarget(prevTarget);

  for (const mesh of meshes) {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  cached = rt.texture;
  return cached;
};
