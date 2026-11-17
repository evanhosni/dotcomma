// The sun, moon and stars as geometry: jittery low-poly bodies whose vertices re-roll every
// JITTER_INTERVAL_S (world/sky/day-night/DayNightCycle.tsx drives them). The look knobs are the constants below.
import * as THREE from "three";
import type { JitterBody } from "./types";
import { JITTER_AMPLITUDE, QUANT_BASE, QUANT_DEGRADE } from "./constants";

/** A flat irregular disc (the sun): a fan around the center, rim radius and angle jittered by (1 − roundness). */
export const buildDisc = (radius: number, rim: number, roundness: number): JitterBody => {
  const irregularity = 1 - Math.min(Math.max(roundness, 0), 1);
  const positions: number[] = [0, 0, 0];
  for (let i = 0; i < rim; i++) {
    const a = (i / rim) * Math.PI * 2 + (Math.random() - 0.5) * 0.7 * irregularity;
    const r = radius * (1 - 0.45 * irregularity + Math.random() * 0.68 * irregularity);
    positions.push(Math.cos(a) * r, Math.sin(a) * r, 0);
  }
  const indices: number[] = [];
  for (let i = 1; i <= rim; i++) indices.push(0, i, (i % rim) + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return { geometry, base: new Float32Array(positions), radius };
};

/** A crescent (the moon): the outer circle minus an offset inner one, both edges wobbled by (1 − roundness). */
export const buildCrescent = (radius: number, vertexCount: number, roundness: number): JitterBody => {
  const irregularity = 1 - Math.min(Math.max(roundness, 0), 1);
  const wobble = (): number => 1 + (Math.random() - 0.5) * 0.5 * irregularity;
  const outerSegs = Math.max(5, Math.round(vertexCount * 0.58));
  const innerSegs = Math.max(4, vertexCount - outerSegs);
  const innerR = radius * 0.92;
  const innerCx = radius * 0.5;
  // Circle-circle intersection → crescent tips
  const ix = (radius * radius + innerCx * innerCx - innerR * innerR) / (2 * innerCx);
  const iy = Math.sqrt(Math.max(radius * radius - ix * ix, 0));
  const tip = Math.atan2(iy, ix); // upper tip angle on the outer circle
  const shape = new THREE.Shape();
  for (let i = 0; i <= outerSegs; i++) {
    const a = tip + ((Math.PI * 2 - 2 * tip) * i) / outerSegs;
    const r = radius * (i === 0 || i === outerSegs ? 1 : wobble()); // tips stay exact
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const phi = Math.atan2(iy, ix - innerCx); // tip angle on the inner circle
  // Concave inner edge, lower tip back to upper tip (angle runs -phi → phi - 2π).
  for (let i = 1; i < innerSegs; i++) {
    const a = -phi + ((2 * phi - Math.PI * 2) * i) / innerSegs;
    const r = innerR * wobble();
    shape.lineTo(innerCx + Math.cos(a) * r, Math.sin(a) * r);
  }
  const geometry = new THREE.ShapeGeometry(shape);
  const base = new Float32Array((geometry.getAttribute("position") as THREE.BufferAttribute).array);
  return { geometry, base, radius };
};

/** Re-rolls every vertex around its base position, snapped to a coarse grid: the low-poly boil.
 *  `degrade` (0..1) coarsens the grid so the shrinking body reads as even lower poly. */
export const jitterBody = (body: JitterBody, degrade: number): void => {
  const attr = body.geometry.getAttribute("position") as THREE.BufferAttribute;
  const amp = body.radius * JITTER_AMPLITUDE;
  const q = body.radius * (QUANT_BASE + degrade * QUANT_DEGRADE);
  const arr = attr.array as Float32Array;
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = Math.round((body.base[i] + (Math.random() * 2 - 1) * amp) / q) * q;
    arr[i + 1] = Math.round((body.base[i + 1] + (Math.random() * 2 - 1) * amp) / q) * q;
    arr[i + 2] = Math.round(((Math.random() * 2 - 1) * amp * 0.5) / q) * q;
  }
  attr.needsUpdate = true;
};

/** Points scattered over the upper hemisphere at `distance` (random per session: stars carry no meaning). */
export const buildStarField = (count: number, distance: number): THREE.BufferGeometry => {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const azimuth = Math.random() * Math.PI * 2;
    const y = 0.06 + Math.random() * 0.94; // upper hemisphere only
    const horizontal = Math.sqrt(1 - y * y);
    positions[i * 3] = Math.cos(azimuth) * horizontal * distance;
    positions[i * 3 + 1] = y * distance;
    positions[i * 3 + 2] = Math.sin(azimuth) * horizontal * distance;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
};
