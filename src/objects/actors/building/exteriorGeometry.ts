import * as THREE from "three";
import { cross, madd, normalize, sub, TriangleSink, type Vec3 } from "./buildingGeometry";
import { edgeLength, edgePoint, interpRing, ringPoints } from "./rings";
import { BuildingPlan, DoorPlan, ExteriorLoft, WindowSpec } from "./types";

// The shell: lofted masses with their door openings, and the windows floated on them.

/** With `flip` the surface is wound to face the interior — the shell's inner face IS the perimeter wall. */
export const emitLoft = (
  sink: TriangleSink,
  loft: ExteriorLoft,
  doors: DoorPlan[],
  o?: { inset?: number; flip?: boolean; color?: number },
): void => {
  sink.setColor(o?.color ?? loft.color);
  const inset = o?.inset ?? 0;
  const flip = o?.flip ?? false;
  const adj = (L: { y: number; cx: number; cz: number; halfWidth: number; halfDepth: number }) =>
    inset ? { ...L, halfWidth: Math.max(L.halfWidth - inset, 0.4), halfDepth: Math.max(L.halfDepth - inset, 0.4) } : L;
  // Explicit rings may hold coincident points (a hip roof's collapsed edges): their zero-area triangles
  // are dropped, they would only be degenerate triangles in the trimesh collider.
  const solidTri = (a: Vec3, b: Vec3, c: Vec3): void => {
    const n = cross(sub(b, a), sub(c, a));
    if (n[0] * n[0] + n[1] * n[1] + n[2] * n[2] > 1e-10) sink.tri(a, b, c);
  };
  const q = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): void => {
    if (flip) [a, b, c, d] = [d, c, b, a];
    if (!loft.points) return sink.quad(a, b, c, d);
    solidTri(a, b, c);
    solidTri(a, c, d);
  };
  const ringAtLevel = (i: number, level: ExteriorLoft["levels"][number]) =>
    loft.points?.[i] ?? ringPoints(loft.rect, loft.sides, level, loft.ringRotation);

  for (let i = 0; i < loft.levels.length - 1; i++) {
    const A = adj(loft.levels[i]);
    const B = adj(loft.levels[i + 1]);
    const ptsA = ringAtLevel(i, A);
    const ptsB = ringAtLevel(i + 1, B);
    const n = ptsA.length;
    for (let j = 0; j < n; j++) {
      const door = i === 0 ? doors.find((d) => d.edge === j) : undefined;
      if (!door) {
        const j1 = (j + 1) % n;
        q(
          [ptsA[j][0], A.y, ptsA[j][1]],
          [ptsA[j1][0], A.y, ptsA[j1][1]],
          [ptsB[j1][0], B.y, ptsB[j1][1]],
          [ptsB[j][0], B.y, ptsB[j][1]],
        );
        continue;
      }
      // Door band facet: left / right / sill / header sub-quads around the opening.
      const sq = (t0: number, t1: number, y0: number, y1: number): void => {
        const p0 = edgePoint(ptsA, j, t0);
        const p1 = edgePoint(ptsA, j, t1);
        q([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]]);
      };
      if (door.t0 > 0.001) sq(0, door.t0, A.y, B.y);
      if (door.t1 < 0.999) sq(door.t1, 1, A.y, B.y);
      if (A.y < -0.001) sq(door.t0, door.t1, A.y, 0);
      if (B.y - door.height > 0.001) sq(door.t0, door.t1, door.height, B.y);
    }
  }
  if (loft.hasRoofFan && !flip) {
    const top = loft.levels[loft.levels.length - 1];
    const pts = ringAtLevel(loft.levels.length - 1, top);
    const c: Vec3 = [top.cx, top.y, top.cz];
    for (let j = 0; j < pts.length; j++) {
      const j1 = (j + 1) % pts.length;
      sink.tri(c, [pts[j][0], top.y, pts[j][1]], [pts[j1][0], top.y, pts[j1][1]]);
    }
  }
};

const emitWindow = (
  sink: TriangleSink,
  lofts: ExteriorLoft[],
  spec: WindowSpec,
  lightChance: number,
  lightIntensity: number,
): void => {
  const loft = lofts[spec.loft];
  const ringC = interpRing(loft.levels, spec.y);
  const ptsC = ringPoints(loft.rect, loft.sides, ringC, loft.ringRotation);
  const L = edgeLength(ptsC, spec.edge);
  const wEff = Math.min(spec.w, L * spec.maxFrac);
  if (wEff < 0.3) return;
  const t0 = spec.edgeParam - wEff / 2 / L;
  const t1 = spec.edgeParam + wEff / 2 / L;
  const y0 = spec.y - spec.h / 2;
  const y1 = spec.y + spec.h / 2;
  const ptsA = ringPoints(loft.rect, loft.sides, interpRing(loft.levels, y0), loft.ringRotation);
  const ptsB = ringPoints(loft.rect, loft.sides, interpRing(loft.levels, y1), loft.ringRotation);
  const pA0 = edgePoint(ptsA, spec.edge, t0);
  const pA1 = edgePoint(ptsA, spec.edge, t1);
  const pB1 = edgePoint(ptsB, spec.edge, t1);
  const pB0 = edgePoint(ptsB, spec.edge, t0);
  const bl: Vec3 = [pA0[0], y0, pA0[1]];
  const br: Vec3 = [pA1[0], y0, pA1[1]];
  const tr: Vec3 = [pB1[0], y1, pB1[1]];
  const tl: Vec3 = [pB0[0], y1, pB0[1]];
  const n = normalize(cross(sub(br, bl), sub(tl, bl)));
  const c: Vec3 = [(bl[0] + br[0] + tr[0] + tl[0]) / 4, (bl[1] + br[1] + tr[1] + tl[1]) / 4, (bl[2] + br[2] + tr[2] + tl[2]) / 4];

  // The wall between y0 and y1 can bulge outward through a flat window; float it past the deepest bulge.
  let bulge = 0;
  for (const lv of loft.levels) {
    if (lv.y <= y0 + 0.01 || lv.y >= y1 - 0.01) continue;
    const pts = ringPoints(loft.rect, loft.sides, lv, loft.ringRotation);
    const p = edgePoint(pts, spec.edge, spec.edgeParam);
    const d = (p[0] - bl[0]) * n[0] + (lv.y - bl[1]) * n[1] + (p[1] - bl[2]) * n[2];
    if (d > bulge) bulge = d;
  }
  if (bulge > 0.8) return; // a floating window looks worse than none

  const U = normalize(sub(br, bl));
  if (spec.round) {
    const V = normalize(sub(tl, bl));
    const rU = wEff / 2;
    const rV = spec.h / 2;
    const fan = (scale: number, off: number, color: number): void => {
      sink.setColor(color);
      const C = madd(c, n, off);
      const SEGMENTS = 12;
      for (let i = 0; i < SEGMENTS; i++) {
        const a0 = (i / SEGMENTS) * Math.PI * 2;
        const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
        const p0 = madd(madd(C, U, Math.cos(a0) * rU * scale), V, Math.sin(a0) * rV * scale);
        const p1 = madd(madd(C, U, Math.cos(a1) * rU * scale), V, Math.sin(a1) * rV * scale);
        sink.tri(C, p0, p1);
      }
    };
    // aWindow.x encodes the depth-bias layer: frame = rnd (0..1], glass = rnd + 1
    // (the shader recovers rnd with fract()). Chance 0 keeps the frame unlit.
    const rndR = Math.max(spec.lightRandom, 1e-3);
    sink.setWindow(rndR, 0);
    fan(1, bulge + 0.05, spec.frame);
    sink.setWindow(rndR + 1, lightChance, lightIntensity);
    fan(0.7, bulge + 0.1, spec.glass);
    sink.setWindow(0, 0);
  } else {
    const tlS = madd(tl, U, spec.skew);
    const trS = madd(tr, U, spec.skew);
    const shrink = (p: Vec3, f: number): Vec3 => [
      c[0] + (p[0] - c[0]) * f,
      c[1] + (p[1] - c[1]) * f,
      c[2] + (p[2] - c[2]) * f,
    ];
    const rndQ = Math.max(spec.lightRandom, 1e-3);
    sink.setColor(spec.frame);
    sink.setWindow(rndQ, 0);
    sink.quad(madd(bl, n, bulge + 0.05), madd(br, n, bulge + 0.05), madd(trS, n, bulge + 0.05), madd(tlS, n, bulge + 0.05));
    sink.setColor(spec.glass);
    sink.setWindow(rndQ + 1, lightChance, lightIntensity);
    sink.quad(
      madd(shrink(bl, 0.68), n, bulge + 0.1),
      madd(shrink(br, 0.68), n, bulge + 0.1),
      madd(shrink(trS, 0.68), n, bulge + 0.1),
      madd(shrink(tlS, 0.68), n, bulge + 0.1),
    );
    sink.setWindow(0, 0);
  }
};

export const buildExteriorGeometry = (plan: BuildingPlan): { geometry: THREE.BufferGeometry; bodyPositionFloatCount: number } => {
  const sink = new TriangleSink();
  plan.lofts.forEach((loft, i) => emitLoft(sink, loft, i === 0 ? plan.doors : []));
  const bodyPositionFloatCount = sink.positions.length; // windows excluded from the collider
  for (const w of plan.windows) emitWindow(sink, plan.lofts, w, plan.windowLightChance, plan.windowLightIntensity);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(sink.positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(sink.colors, 3));
  geometry.setAttribute("aWindow", new THREE.Float32BufferAttribute(sink.windowAttributes, 3));
  geometry.computeVertexNormals(); // non-indexed → flat faceted shading
  return { geometry, bodyPositionFloatCount };
};
