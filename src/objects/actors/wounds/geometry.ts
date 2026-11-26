import * as THREE from "three";
import { seedRand } from "../../../utils/math";

const SIDES = 9;
const RINGS = 7;
/** How far the flesh bulges into a tunnel, as a share of its radius (lumps inward only: outward they would
 *  poke out of the body). */
const LUMP_DEPTH = 0.35;
/** The tunnel's ends sit just inside its holes' rims, so no sliver of the body's inside shows between them. */
const RIM_FIT = 0.96;

/**
 * One bullet tunnel: a lumpy open tube from its entry hole (y 0, radius `entryRadius`) to its exit (y 1,
 * `exitRadius`), stretched along y to the holes' distance each frame (WoundSet.ts). Its lumps are its own
 * (`seed`), and its ends are round, to meet the holes.
 */
export const woundTunnelGeometry = (entryRadius: number, exitRadius: number, seed: number): THREE.BufferGeometry => {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, SIDES, RINGS, true).translate(0, 0.5, 0);
  const position = geometry.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const t = v.y;
    const ring = Math.round(t * RINGS);
    // The seam's two copies of a vertex lump alike: keyed by ring and side, the side taken round the circle.
    const side = Math.round(((Math.atan2(v.z, v.x) / (Math.PI * 2) + 1) % 1) * SIDES) % SIDES;
    const ends = ring === 0 || ring === RINGS;
    const lump = ends ? 0 : seedRand(seed * 1013 + ring * 31 + side) * LUMP_DEPTH;
    const radius = (entryRadius + (exitRadius - entryRadius) * t) * RIM_FIT * (1 - lump);
    position.setXYZ(i, v.x * radius, t, v.z * radius);
  }
  geometry.computeVertexNormals();
  return geometry;
};

const RIM_SIDES = 14;
/** The rim's profile from its inner edge out: [radius, height along the skin's outward normal], in hole radii.
 *  It dips into the hole over the tunnel's mouth, swells into a lip of torn flesh over the cut edge of the
 *  skin (at radius 1), and sinks back under the skin, so it meets the body with no seam however the skin
 *  curves there. */
const RIM_PROFILE: readonly (readonly [number, number])[] = [
  [0.62, -0.35],
  [0.8, -0.05],
  [1.02, 0.14],
  [1.28, 0.08],
  [1.5, -0.12],
];
/** How unevenly the lip is torn, as a share of its radius and height. */
const RIM_LUMP = 0.22;

/**
 * One hole's RIM: a lumpy ring of flesh around it, in hole radii (WoundSet scales it by the hole's radius), +y
 * the skin's outward normal. It hides the seam between the cut skin and the tunnel's mouth.
 */
export const woundRimGeometry = (seed: number): THREE.BufferGeometry => {
  const positions: number[] = [];
  const indices: number[] = [];
  RIM_PROFILE.forEach(([radius, height], ring) => {
    for (let side = 0; side < RIM_SIDES; side++) {
      const angle = (side / RIM_SIDES) * Math.PI * 2;
      // The inner edge stays round: it lines the tunnel's mouth.
      const lump = ring === 0 ? 1 : 1 + (seedRand(seed * 733 + ring * 37 + side) - 0.5) * RIM_LUMP;
      positions.push(Math.cos(angle) * radius * lump, height * lump, Math.sin(angle) * radius * lump);
    }
  });
  for (let ring = 0; ring < RIM_PROFILE.length - 1; ring++) {
    for (let side = 0; side < RIM_SIDES; side++) {
      const a = ring * RIM_SIDES + side;
      const b = ring * RIM_SIDES + ((side + 1) % RIM_SIDES);
      indices.push(a, a + RIM_SIDES, b, b, a + RIM_SIDES, b + RIM_SIDES);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};
