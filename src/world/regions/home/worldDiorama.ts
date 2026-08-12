import * as THREE from "three";

/**
 * A tiny HAND-BUILT diorama of glitch-city — the preview thumbnail on the
 * CrtMonitor's world selector: a cross-section of the three biomes side by
 * side — grass hills, the city (flat plateau, road grid, box towers), desert
 * dunes — baked ONCE into a very low-res nearest-filtered render target, so
 * the screen shows an actual (pixelated) view of the world without running
 * any of the real generation pipeline. Everything here is manual: sine-bump
 * heights, seeded hash jitter, hand-picked colors approximating the real
 * biome palettes. RES is the pixelation knob.
 */

/** Bake resolution — the pixelation of the portal image IS this number. */
const RES = 64;

let cached: THREE.Texture | null = null;

const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Distance from v to the nearest lattice line (multiples of 18, offset o). */
const lineDist = (v: number, o: number): number => {
  const m = (((v - o) % 18) + 18) % 18;
  return Math.min(m, 18 - m);
};

export const getWorldDioramaTexture = (gl: THREE.WebGLRenderer): THREE.Texture => {
  if (cached) return cached;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0620");
  scene.fog = new THREE.Fog("#0b0620", 140, 330);

  const sun = new THREE.DirectionalLight("#ffe9c4", 2.4);
  sun.position.set(60, 90, 50);
  scene.add(sun, new THREE.AmbientLight("#7788dd", 0.55));

  // ── Terrain: grass | city | desert along x, hand-blended ────────────────
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

    // Zone weights (grass < -30 < city < 30 < desert, soft borders)
    const desertW = smoothstep(22, 42, x);
    const grassW = 1 - smoothstep(-42, -22, x);
    const cityW = 1 - grassW - desertW;

    const hills = Math.max(0, 5 + 6 * (Math.sin(x * 0.055) * Math.cos(z * 0.07) + 0.5 * Math.sin(x * 0.11 + 1.7)));
    const dunes = Math.max(0, 4 + 5 * (Math.sin(x * 0.06 + z * 0.045) + 0.5 * Math.sin(z * 0.1 + 2)));
    pos.setY(i, grassW * hills + desertW * dunes);

    // Road grid on the city plateau, running BETWEEN the tower lattice
    // (towers sit at x≡0 / z≡9 mod 18, roads at x≡9 / z≡0)
    const onRoad = lineDist(x, 9) < 2.5 || lineDist(z, 0) < 2.5;
    const cityGround = onRoad ? asphalt : plaza;

    // Weighted zone blend + per-vertex jitter so the flats aren't uniform
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
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(terrain);

  // ── City towers: box grid between the roads, seeded heights ─────────────
  const towerMats: THREE.Material[] = [];
  const towerGeos: THREE.BufferGeometry[] = [];
  for (const bx of [-18, 0, 18]) {
    for (let bz = -63; bz <= 63; bz += 18) {
      const roll = hash(bx, bz);
      if (roll < 0.3) continue; // empty lot
      const h = 7 + roll * 26;
      const g = new THREE.BoxGeometry(11, h, 11);
      const shade = 0.3 + 0.45 * hash(bz, bx);
      const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(shade, shade, shade) });
      const tower = new THREE.Mesh(g, m);
      tower.position.set(bx, h / 2, bz);
      scene.add(tower);
      towerGeos.push(g);
      towerMats.push(m);
    }
  }

  // ── Bake ─────────────────────────────────────────────────────────────────
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

  // The texture is all we keep — free the one-off scene
  geo.dispose();
  (terrain.material as THREE.Material).dispose();
  towerGeos.forEach((g) => g.dispose());
  towerMats.forEach((m) => m.dispose());

  cached = rt.texture;
  return cached;
};
