import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { INDOOR_COLLIDER_PADDING } from "../../portals/constants";
import { generateBuildingPlan, RAMP_THICKNESS, RAMP_WIDTH, SLAB_THICKNESS, WALL_THICKNESS } from "./generatePlan";
import { edgeLength, edgePoint, interpRing, ringPoints } from "./rings";
import { BuildingOptions, BuildingPlan, DoorPlan, ExteriorLoft, RoomRect, WallBox, WindowSpec } from "./types";

/**
 * Turns a BuildingPlan into renderable geometry, cached per (seed, options)
 * like portalAssets does per building type. Buildings respawn as the player
 * moves through the city, so a despawn/respawn cycle costs an O(1) lookup
 * instead of a re-triangulation.
 *
 * Building colors are baked as vertex colors so every building shares ONE
 * exterior material (shader-variant stability) while still looking unique.
 */

type Vec3 = [number, number, number];

export interface PortalPlacement {
  name: string;
  position: Vec3;
  rotation: Vec3;
  size: [number, number];
}

export interface RampCollider {
  position: Vec3;
  rotation: Vec3;
  halfExtents: Vec3;
}

export interface ProceduralBuildingAssets {
  plan: BuildingPlan;
  exteriorGeometry: THREE.BufferGeometry;
  /** Trimesh collider data — the body triangles only (windows excluded), so
   *  the door openings are walkable with no named-mesh exclusion dance. */
  exteriorVertices: Float32Array;
  exteriorIndices: Uint32Array;
  wallGeometry: THREE.BufferGeometry;
  floorGeometry: THREE.BufferGeometry;
  ceilingGeometry: THREE.BufferGeometry;
  lightsGeometry: THREE.BufferGeometry | null;
  /** Every axis-aligned interior collider: walls on all stories, slabs
   *  (with the ramp-shaft holes), padded bottom floor and top ceiling. */
  interiorColliders: WallBox[];
  /** One rotated cuboid per ramp flight. */
  rampColliders: RampCollider[];
  /** Shared door-opening plane, used by every portal surface of this building. */
  doorGeometry: THREE.BufferGeometry;
  enterPortals: PortalPlacement[];
  exitPortals: PortalPlacement[];
}

const _color = new THREE.Color();

// Tiny Vec3 helpers (plain arrays; no THREE allocations in the hot path)
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const madd = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

class TriangleSink {
  positions: number[] = [];
  colors: number[] = [];
  private r = 1;
  private g = 1;
  private b = 1;

  setColor(hex: number): void {
    _color.set(hex); // converts sRGB hex to the working color space
    this.r = _color.r;
    this.g = _color.g;
    this.b = _color.b;
  }

  tri(a: Vec3, b: Vec3, c: Vec3): void {
    this.positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.colors.push(this.r, this.g, this.b);
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
}

const emitLoft = (sink: TriangleSink, loft: ExteriorLoft, doors: DoorPlan[]): void => {
  sink.setColor(loft.color);
  for (let i = 0; i < loft.levels.length - 1; i++) {
    const A = loft.levels[i];
    const B = loft.levels[i + 1];
    const ptsA = ringPoints(loft.rect, loft.sides, A, loft.phase);
    const ptsB = ringPoints(loft.rect, loft.sides, B, loft.phase);
    const n = ptsA.length;
    for (let j = 0; j < n; j++) {
      const door = i === 0 ? doors.find((d) => d.edge === j) : undefined;
      if (!door) {
        const j1 = (j + 1) % n;
        sink.quad(
          [ptsA[j][0], A.y, ptsA[j][1]],
          [ptsA[j1][0], A.y, ptsA[j1][1]],
          [ptsB[j1][0], B.y, ptsB[j1][1]],
          [ptsB[j][0], B.y, ptsB[j][1]],
        );
        continue;
      }
      // Door band facet (prismatic — ptsA === ptsB shape-wise): carve the
      // opening as left / right / sill / header sub-quads.
      const sq = (t0: number, t1: number, y0: number, y1: number): void => {
        const p0 = edgePoint(ptsA, j, t0);
        const p1 = edgePoint(ptsA, j, t1);
        sink.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]]);
      };
      if (door.t0 > 0.001) sq(0, door.t0, A.y, B.y);
      if (door.t1 < 0.999) sq(door.t1, 1, A.y, B.y);
      if (A.y < -0.001) sq(door.t0, door.t1, A.y, 0); // below the sill (foundation)
      if (B.y - door.height > 0.001) sq(door.t0, door.t1, door.height, B.y); // header
    }
  }
  if (loft.roof) {
    const top = loft.levels[loft.levels.length - 1];
    const pts = ringPoints(loft.rect, loft.sides, top, loft.phase);
    const c: Vec3 = [top.cx, top.y, top.cz];
    for (let j = 0; j < pts.length; j++) {
      const j1 = (j + 1) % pts.length;
      sink.tri(c, [pts[j][0], top.y, pts[j][1]], [pts[j1][0], top.y, pts[j1][1]]);
    }
  }
};

const emitWindow = (sink: TriangleSink, lofts: ExteriorLoft[], spec: WindowSpec): void => {
  const loft = lofts[spec.loft];
  const ringC = interpRing(loft.levels, spec.y);
  const ptsC = ringPoints(loft.rect, loft.sides, ringC, loft.phase);
  const L = edgeLength(ptsC, spec.edge);
  const wEff = Math.min(spec.w, L * spec.maxFrac);
  if (wEff < 0.3) return; // facet too small up here
  const t0 = spec.t - wEff / 2 / L;
  const t1 = spec.t + wEff / 2 / L;
  const y0 = spec.y - spec.h / 2;
  const y1 = spec.y + spec.h / 2;
  const ptsA = ringPoints(loft.rect, loft.sides, interpRing(loft.levels, y0), loft.phase);
  const ptsB = ringPoints(loft.rect, loft.sides, interpRing(loft.levels, y1), loft.phase);
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

  // The window plane is the chord between the wall at y0 and y1 — but the
  // wall between them can bulge outward (segment lips / mid-segment bulge
  // levels), which would cut through a flat window. Sample the wall at every
  // level ring crossing the window's span and float the window past the
  // deepest bulge.
  let bulge = 0;
  for (const lv of loft.levels) {
    if (lv.y <= y0 + 0.01 || lv.y >= y1 - 0.01) continue;
    const pts = ringPoints(loft.rect, loft.sides, lv, loft.phase);
    const p = edgePoint(pts, spec.edge, spec.t);
    const d = (p[0] - bl[0]) * n[0] + (lv.y - bl[1]) * n[1] + (p[1] - bl[2]) * n[2];
    if (d > bulge) bulge = d;
  }
  if (bulge > 0.8) return; // wall too curved here — a floating window looks worse than none

  const U = normalize(sub(br, bl));
  if (spec.round) {
    // Porthole: rim ellipse + smaller glass ellipse, both proud of the wall
    // (w and h differ, so most portholes are ovals)
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
    fan(1, bulge + 0.05, spec.frame);
    fan(0.7, bulge + 0.1, spec.glass);
  } else {
    // Quad window: frame + inset glass, top edge sheared by `skew` so the
    // shape is a subtle parallelogram rather than a perfect rectangle
    const tlS = madd(tl, U, spec.skew);
    const trS = madd(tr, U, spec.skew);
    const shrink = (p: Vec3, f: number): Vec3 => [
      c[0] + (p[0] - c[0]) * f,
      c[1] + (p[1] - c[1]) * f,
      c[2] + (p[2] - c[2]) * f,
    ];
    sink.setColor(spec.frame);
    sink.quad(madd(bl, n, bulge + 0.05), madd(br, n, bulge + 0.05), madd(trS, n, bulge + 0.05), madd(tlS, n, bulge + 0.05));
    sink.setColor(spec.glass);
    sink.quad(
      madd(shrink(bl, 0.68), n, bulge + 0.1),
      madd(shrink(br, 0.68), n, bulge + 0.1),
      madd(shrink(trS, 0.68), n, bulge + 0.1),
      madd(shrink(tlS, 0.68), n, bulge + 0.1),
    );
  }
};

const buildExteriorGeometry = (plan: BuildingPlan): { geometry: THREE.BufferGeometry; bodyFloats: number } => {
  const sink = new TriangleSink();
  plan.lofts.forEach((loft, i) => emitLoft(sink, loft, i === 0 ? plan.doors : []));
  const bodyFloats = sink.positions.length; // windows excluded from the collider
  for (const w of plan.windows) emitWindow(sink, plan.lofts, w);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(sink.positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(sink.colors, 3));
  geometry.computeVertexNormals(); // non-indexed → flat faceted shading
  return { geometry, bodyFloats };
};

const box = (b: WallBox): THREE.BoxGeometry => {
  const g = new THREE.BoxGeometry(b.sx, b.sy, b.sz);
  if (b.rotY) g.rotateY(b.rotY);
  return g.translate(b.cx, b.cy, b.cz);
};

const rectBox = (r: RoomRect, y0: number, y1: number): WallBox => ({
  cx: (r.x0 + r.x1) / 2,
  cy: (y0 + y1) / 2,
  cz: (r.z0 + r.z1) / 2,
  sx: r.x1 - r.x0,
  sy: y1 - y0,
  sz: r.z1 - r.z0,
});

const buildInteriorGeometries = (plan: BuildingPlan) => {
  const {
    width,
    depth,
    ceilingHeight: ch,
    stories,
    storyHeight,
    wallBoxesCommon,
    perimeterGround,
    perimeterUpper,
    ramp,
    lightPanels,
  } = plan.interior;
  const T = WALL_THICKNESS;
  const PAD = INDOOR_COLLIDER_PADDING;
  const X0 = -width / 2 - T;
  const X1 = width / 2 + T;
  const Z0 = -depth / 2 - T;
  const Z1 = depth / 2 + T;

  const wallGeos: THREE.BufferGeometry[] = [];
  const floorGeos: THREE.BufferGeometry[] = [];
  const ceilGeos: THREE.BufferGeometry[] = [];
  const interiorColliders: WallBox[] = [];
  const rampColliders: RampCollider[] = [];

  // Walls, replicated per story (ground story carries the exit-door carves)
  for (let s = 0; s < stories; s++) {
    const yOff = s * storyHeight;
    for (const b of [...wallBoxesCommon, ...(s === 0 ? perimeterGround : perimeterUpper)]) {
      const shifted = { ...b, cy: b.cy + yOff };
      wallGeos.push(box(shifted));
      interiorColliders.push(shifted);
    }
  }

  // Bottom floor slab (solid, collider padded past the walls for portal crossings)
  floorGeos.push(box(rectBox({ x0: X0, z0: Z0, x1: X1, z1: Z1 }, -SLAB_THICKNESS, 0)));
  interiorColliders.push({ cx: 0, cy: -SLAB_THICKNESS / 2, cz: 0, sx: width + 2 * PAD, sy: SLAB_THICKNESS, sz: depth + 2 * PAD });

  // Inter-story slabs: full rect minus the ramp-shaft hole; each piece split
  // into a floor-material top layer and a ceiling-material underside.
  const slabPieces = ((): RoomRect[] => {
    const full = { x0: X0, z0: Z0, x1: X1, z1: Z1 };
    if (!ramp) return [full];
    const h = ramp.hole;
    return [
      { x0: X0, z0: Z0, x1: h.x0, z1: Z1 },
      { x0: h.x1, z0: Z0, x1: X1, z1: Z1 },
      { x0: h.x0, z0: Z0, x1: h.x1, z1: h.z0 },
      { x0: h.x0, z0: h.z1, x1: h.x1, z1: Z1 },
    ].filter((p) => p.x1 - p.x0 > 0.02 && p.z1 - p.z0 > 0.02);
  })();

  for (let s = 1; s < stories; s++) {
    const yTop = s * storyHeight; // story s floor surface
    for (const p of slabPieces) {
      floorGeos.push(box(rectBox(p, yTop - SLAB_THICKNESS / 2, yTop)));
      ceilGeos.push(box(rectBox(p, yTop - SLAB_THICKNESS, yTop - SLAB_THICKNESS / 2)));
      interiorColliders.push(rectBox(p, yTop - SLAB_THICKNESS, yTop));
    }
  }

  // Top ceiling (solid)
  const topY = (stories - 1) * storyHeight + ch;
  ceilGeos.push(box(rectBox({ x0: X0, z0: Z0, x1: X1, z1: Z1 }, topY, topY + SLAB_THICKNESS)));
  interiorColliders.push({ cx: 0, cy: topY + SLAB_THICKNESS / 2, cz: 0, sx: width + 2 * PAD, sy: SLAB_THICKNESS, sz: depth + 2 * PAD });

  // Ramp flights: one inclined slab per story gap — the SAME box is the
  // visual (merged into the floor geometry) and the collider, so feet and
  // eyes always agree.
  if (ramp) {
    const run = ramp.runEnd - ramp.runStart;
    const theta = Math.atan2(storyHeight, run);
    const hyp = Math.sqrt(run * run + storyHeight * storyHeight);
    const cx = (ramp.runStart + ramp.runEnd) / 2;
    const cz = (ramp.laneZ0 + ramp.laneZ1) / 2;
    for (let s = 0; s < stories - 1; s++) {
      // sunk slightly so the top surface meets both floors flush
      const cy = s * storyHeight + storyHeight / 2 - 0.1;
      floorGeos.push(new THREE.BoxGeometry(hyp, RAMP_THICKNESS, RAMP_WIDTH).rotateZ(theta).translate(cx, cy, cz));
      rampColliders.push({
        position: [cx, cy, cz],
        rotation: [0, 0, theta],
        halfExtents: [hyp / 2, RAMP_THICKNESS / 2, RAMP_WIDTH / 2],
      });
    }
  }

  const wallGeometry = mergeGeometries(wallGeos, false);
  const floorGeometry = mergeGeometries(floorGeos, false);
  const ceilingGeometry = mergeGeometries(ceilGeos, false);
  [...wallGeos, ...floorGeos, ...ceilGeos].forEach((g) => g.dispose());

  let lightsGeometry: THREE.BufferGeometry | null = null;
  if (lightPanels.length > 0) {
    const panels: THREE.BufferGeometry[] = [];
    for (let s = 0; s < stories; s++) {
      for (const [x, z] of lightPanels) {
        // rotateX(π/2) points the plane's +z normal down at the floor
        panels.push(new THREE.PlaneGeometry(1.4, 2.8).rotateX(Math.PI / 2).translate(x, s * storyHeight + ch - 0.02, z));
      }
    }
    lightsGeometry = mergeGeometries(panels, false);
    panels.forEach((g) => g.dispose());
  }

  return { wallGeometry, floorGeometry, ceilingGeometry, lightsGeometry, interiorColliders, rampColliders };
};

const cache = new Map<string, ProceduralBuildingAssets>();
const MAX_CACHE = 64;

const disposeAssets = (a: ProceduralBuildingAssets): void => {
  a.exteriorGeometry.dispose();
  a.wallGeometry.dispose();
  a.floorGeometry.dispose();
  a.ceilingGeometry.dispose();
  a.lightsGeometry?.dispose();
  a.doorGeometry.dispose();
};

export const getProceduralBuildingAssets = (seed: string, opts: BuildingOptions): ProceduralBuildingAssets => {
  const key = `${seed}|${JSON.stringify(opts)}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const plan = generateBuildingPlan(seed, opts);

  const { geometry: exteriorGeometry, bodyFloats } = buildExteriorGeometry(plan);
  const allVerts = (exteriorGeometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
  const exteriorVertices = allVerts.slice(0, bodyFloats);
  const exteriorIndices = new Uint32Array(bodyFloats / 3);
  for (let i = 0; i < exteriorIndices.length; i++) exteriorIndices[i] = i;

  const doorGeometry = new THREE.PlaneGeometry(plan.doors[0].width, plan.doors[0].height);

  const assets: ProceduralBuildingAssets = {
    plan,
    exteriorGeometry,
    exteriorVertices,
    exteriorIndices,
    ...buildInteriorGeometries(plan),
    doorGeometry,
    enterPortals: plan.doors.map((d, i) => ({
      name: `door${i}`,
      position: d.position,
      rotation: [0, d.yaw, 0] as Vec3,
      size: [d.width, d.height] as [number, number],
    })),
    // Exit portals face INTO the interior (yaw computed in the plan): the
    // pair transform (dest · rotY180 · inv(src)) sends you out along the
    // destination's +z, so outward-facing enter doors paired with
    // inward-facing exit doors walk through correctly both ways.
    exitPortals: plan.interior.exitDoors.map((d, i) => ({
      name: `door${i}`,
      position: d.position,
      rotation: [0, d.yaw, 0] as Vec3,
      size: [d.width, d.height] as [number, number],
    })),
  };

  // Well above the max simultaneously-mounted building count, so an evicted
  // entry is never one that's still on screen.
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value as string;
    disposeAssets(cache.get(oldest)!);
    cache.delete(oldest);
  }
  cache.set(key, assets);
  return assets;
};
