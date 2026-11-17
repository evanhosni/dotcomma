import * as THREE from "three";
import type { Vec3 } from "./types";

const _color = new THREE.Color();

// The primitive every building part is emitted through. Colors are baked as vertex colors (the
// sink's; utils/render/geometry.ts bakes Three primitives) so every building shares ONE exterior
// material.
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
