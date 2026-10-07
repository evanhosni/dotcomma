import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { WallBox } from "./types";

// The primitives every building part is emitted through. Colors are baked as vertex colors so every
// building shares ONE exterior material.

export type Vec3 = [number, number, number];

const _color = new THREE.Color();

/** Drops the uv attribute so every part merges with the uv-less sink geometry. */
export const bakeVertexColor = (geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry => {
  _color.set(hex);
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.deleteAttribute("uv");
  return geometry;
};

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const normalize = (a: Vec3): Vec3 => {
  const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const madd = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

export class TriangleSink {
  positions: number[] = [];
  colors: number[] = [];
  /** aWindow per vertex: [per-window random (+1 = glass layer), light chance, glow]; (0,0,0) off windows. */
  windowAttributes: number[] = [];
  private r = 1;
  private g = 1;
  private b = 1;
  private winRnd = 0;
  private winChance = 0;
  private winGlow = 0;

  setColor(hex: number): void {
    _color.set(hex);
    this.r = _color.r;
    this.g = _color.g;
    this.b = _color.b;
  }

  setWindow(rnd: number, chance: number, glow = 0): void {
    this.winRnd = rnd;
    this.winChance = chance;
    this.winGlow = glow;
  }

  tri(a: Vec3, b: Vec3, c: Vec3): void {
    this.positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) {
      this.colors.push(this.r, this.g, this.b);
      this.windowAttributes.push(this.winRnd, this.winChance, this.winGlow);
    }
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
}

export const wallBoxGeometry = (b: WallBox): THREE.BoxGeometry => {
  const g = new THREE.BoxGeometry(b.sx, b.sy, b.sz);
  if (b.rotY) g.rotateY(b.rotY);
  return g.translate(b.cx, b.cy, b.cz);
};

/** mergeGeometries returns null on mismatched attributes — fail loudly instead of caching a null. */
export const mergeOrThrow = (geos: THREE.BufferGeometry[], label: string): THREE.BufferGeometry => {
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error(`Building geometry merge failed: ${label}`);
  return merged;
};
