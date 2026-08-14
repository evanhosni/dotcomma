import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { FLOOR_LIFT, generateBuildingPlan, RAMP_THICKNESS, RAMP_WIDTH, SLAB_THICKNESS } from "./generatePlan";
import { edgeLength, edgePoint, interpRing, ringPoints } from "./rings";
import { BuildingOptions, BuildingPlan, DoorPlan, ExteriorLoft, WallBox, WindowSpec } from "./types";

/**
 * Turns a BuildingPlan into renderable geometry, cached per (seed, options).
 * Buildings respawn as the player moves through the city, so a
 * despawn/respawn cycle costs an O(1) lookup instead of a re-triangulation.
 *
 * Building colors are baked as vertex colors so every building shares ONE
 * exterior material (shader-variant stability) while still looking unique.
 */

type Vec3 = [number, number, number];

export interface DoorPlacement {
  /** Center of the door opening on the shell (interior-local = building-local). */
  position: Vec3;
  /** +z faces out of the building. */
  yaw: number;
  width: number;
  height: number;
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
  /** The ENTIRE interior (walls, slabs, ramps, light panels) as one
   *  vertex-colored geometry — rendered at all times alongside the shell so
   *  exterior and interior are one consistent building. */
  interiorGeometry: THREE.BufferGeometry;
  /** Wall/pillar cuboids for every story (slabs are the trimesh below). */
  interiorColliders: WallBox[];
  /** One rotated cuboid per ramp flight. */
  rampColliders: RampCollider[];
  /** Exact trimesh for all slabs (ground floor, inter-story with shaft
   *  holes, top ceiling) — clipped to the interior polygon. */
  interiorSlabVertices: Float32Array;
  interiorSlabIndices: Uint32Array;
  /** Swinging door leaf, shared by this building's doors. Origin = hinge
   *  edge (the leaf extends +x), so rotating the parent group swings it. */
  doorGeometry: THREE.BufferGeometry;
  doors: DoorPlacement[];
}

// Interior surface colors come from the plan (derived from the building's
// exterior palette, overridable via BuildingOptions.interiorColors) — only
// the glowing panel color is fixed.
const LIGHT_PANEL_COLOR = 0xfff7d6;

/** Bake a uniform vertex color onto a geometry (converted through
 *  THREE.Color for correct color management) and drop its uv attribute so
 *  every interior part merges cleanly with the shader-less sink geometry. */
const withColor = (geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry => {
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
  /** Per-vertex night-light data: [per-window random (+1 = glass layer),
   *  building light chance, emissive glow intensity]. (0,0,0) everywhere
   *  except window parts — chance 0 can never light. */
  windows: number[] = [];
  private r = 1;
  private g = 1;
  private b = 1;
  private winRnd = 0;
  private winChance = 0;
  private winGlow = 0;

  setColor(hex: number): void {
    _color.set(hex); // converts sRGB hex to the working color space
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
      this.windows.push(this.winRnd, this.winChance, this.winGlow);
    }
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
}

/** Emit a loft's wall surface. With `inset`/`flip` it emits the same surface
 *  pulled inward and wound to face the interior — the shell's INNER face,
 *  which IS the interior perimeter wall (the shell has real thickness). */
const emitLoft = (
  sink: TriangleSink,
  loft: ExteriorLoft,
  doors: DoorPlan[],
  o?: { inset?: number; flip?: boolean; color?: number },
): void => {
  sink.setColor(o?.color ?? loft.color);
  const inset = o?.inset ?? 0;
  const flip = o?.flip ?? false;
  const adj = (L: { y: number; cx: number; cz: number; hw: number; hd: number }) =>
    inset ? { ...L, hw: Math.max(L.hw - inset, 0.4), hd: Math.max(L.hd - inset, 0.4) } : L;
  const q = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): void => (flip ? sink.quad(d, c, b, a) : sink.quad(a, b, c, d));

  for (let i = 0; i < loft.levels.length - 1; i++) {
    const A = adj(loft.levels[i]);
    const B = adj(loft.levels[i + 1]);
    const ptsA = ringPoints(loft.rect, loft.sides, A, loft.phase);
    const ptsB = ringPoints(loft.rect, loft.sides, B, loft.phase);
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
      // Door band facet (prismatic — ptsA === ptsB shape-wise): carve the
      // opening as left / right / sill / header sub-quads.
      const sq = (t0: number, t1: number, y0: number, y1: number): void => {
        const p0 = edgePoint(ptsA, j, t0);
        const p1 = edgePoint(ptsA, j, t1);
        q([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]]);
      };
      if (door.t0 > 0.001) sq(0, door.t0, A.y, B.y);
      if (door.t1 < 0.999) sq(door.t1, 1, A.y, B.y);
      if (A.y < -0.001) sq(door.t0, door.t1, A.y, 0); // below the sill (foundation)
      if (B.y - door.height > 0.001) sq(door.t0, door.t1, door.height, B.y); // header
    }
  }
  if (loft.roof && !flip) {
    const top = loft.levels[loft.levels.length - 1];
    const pts = ringPoints(loft.rect, loft.sides, top, loft.phase);
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
    // Window parts encode a depth-bias layer in aWindow.x: frame = rnd (0..1],
    // glass = rnd + 1 (glass overlaps the frame, so it's pulled further).
    // Chance 0 keeps the frame from ever lighting; the shader recovers the
    // per-window random with fract().
    const rndR = Math.max(spec.litRnd, 1e-3);
    sink.setWindow(rndR, 0);
    fan(1, bulge + 0.05, spec.frame);
    sink.setWindow(rndR + 1, lightChance, lightIntensity); // only the glass glows at night
    fan(0.7, bulge + 0.1, spec.glass);
    sink.setWindow(0, 0);
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
    // Window parts encode a depth-bias layer in aWindow.x: frame = rnd (0..1],
    // glass = rnd + 1 (glass overlaps the frame, so it's pulled further).
    // Chance 0 keeps the frame from ever lighting; the shader recovers the
    // per-window random with fract().
    const rndQ = Math.max(spec.litRnd, 1e-3);
    sink.setColor(spec.frame);
    sink.setWindow(rndQ, 0);
    sink.quad(madd(bl, n, bulge + 0.05), madd(br, n, bulge + 0.05), madd(trS, n, bulge + 0.05), madd(tlS, n, bulge + 0.05));
    sink.setColor(spec.glass);
    sink.setWindow(rndQ + 1, lightChance, lightIntensity); // only the glass glows at night
    sink.quad(
      madd(shrink(bl, 0.68), n, bulge + 0.1),
      madd(shrink(br, 0.68), n, bulge + 0.1),
      madd(shrink(trS, 0.68), n, bulge + 0.1),
      madd(shrink(tlS, 0.68), n, bulge + 0.1),
    );
    sink.setWindow(0, 0);
  }
};

const buildExteriorGeometry = (plan: BuildingPlan): { geometry: THREE.BufferGeometry; bodyFloats: number } => {
  const sink = new TriangleSink();
  plan.lofts.forEach((loft, i) => emitLoft(sink, loft, i === 0 ? plan.doors : []));
  const bodyFloats = sink.positions.length; // windows excluded from the collider
  for (const w of plan.windows) emitWindow(sink, plan.lofts, w, plan.windowLightChance, plan.windowLightIntensity);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(sink.positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(sink.colors, 3));
  // Per-vertex night-light data (per-window random + light chance + glow
  // intensity), read by the exterior material's shader patch. (0,0,0)
  // outside window glass.
  geometry.setAttribute("aWindow", new THREE.Float32BufferAttribute(sink.windows, 3));
  geometry.computeVertexNormals(); // non-indexed → flat faceted shading
  return { geometry, bodyFloats };
};

const box = (b: WallBox): THREE.BoxGeometry => {
  const g = new THREE.BoxGeometry(b.sx, b.sy, b.sz);
  if (b.rotY) g.rotateY(b.rotY);
  return g.translate(b.cx, b.cy, b.cz);
};

/** mergeGeometries returns null when inputs have mismatched attributes or
 *  mixed indexed/non-indexed — fail loudly instead of caching a null. */
const mergeOrThrow = (geos: THREE.BufferGeometry[], label: string): THREE.BufferGeometry => {
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error(`Building geometry merge failed: ${label}`);
  return merged;
};

const buildInteriorGeometries = (plan: BuildingPlan) => {
  const { width, depth, ceilingHeight: ch, stories, storyHeight, wallBoxesPerStory, ramps, lightPanelsPerStory } = plan.interior;
  const { rect, sides, phase } = plan.lofts[0];
  const ihw = width / 2;
  const ihd = depth / 2;

  // Everything visual goes into ONE vertex-colored parts list (all
  // non-indexed so the merge succeeds).
  const parts: THREE.BufferGeometry[] = [];
  const slabColliderGeos: THREE.BufferGeometry[] = [];
  const interiorColliders: WallBox[] = [];
  const rampColliders: RampCollider[] = [];

  // ---- Walls, each story's OWN layout lifted to its floor. There are NO
  // perimeter wall boxes — the perimeter is the shell's inner surface
  // (emitted below), and split walls run all the way into it. ----
  const colors = plan.interior.colors;
  for (let s = 0; s < stories; s++) {
    const yOff = s * storyHeight;
    for (const b of wallBoxesPerStory[s]) {
      const wb: WallBox = { ...b, cy: b.cy + yOff };
      parts.push(withColor(box(wb).toNonIndexed(), colors.wall));
      interiorColliders.push(wb);
    }
  }

  // ---- Inner shell surface: a straight PRISM of the interior polygon from
  // foundation to just above the top floor, wound to face inward. The outer
  // shell leans/tapers around it — the wall cavity between the two surfaces
  // simply varies in thickness. A constant inner surface means split walls
  // can meet it exactly at every story. ----
  const interiorTop = stories * storyHeight + 0.5;
  const doorH = plan.doors[0].height;
  const innerLoft: ExteriorLoft = {
    rect,
    sides,
    phase,
    color: colors.wall,
    roof: false,
    levels: [
      { y: -0.6, cx: 0, cz: 0, hw: ihw, hd: ihd },
      { y: doorH + 1, cx: 0, cz: 0, hw: ihw, hd: ihd },
      { y: interiorTop, cx: 0, cz: 0, hw: ihw, hd: ihd },
    ],
  };
  const innerSink = new TriangleSink();
  emitLoft(innerSink, innerLoft, plan.doors, { flip: true, color: colors.wall });

  // Door reveals: close the wall cavity around each opening (double-faced
  // jamb quads on both sides + the header).
  const band = plan.lofts[0];
  const outerPts = ringPoints(band.rect, band.sides, band.levels[0], band.phase);
  const innerPts = ringPoints(rect, sides, innerLoft.levels[0], phase);
  for (const d of plan.doors) {
    const jamb = (t: number): void => {
      const o = edgePoint(outerPts, d.edge, t);
      const p = edgePoint(innerPts, d.edge, t);
      const a: Vec3 = [o[0], 0, o[1]];
      const b: Vec3 = [o[0], d.height, o[1]];
      const c: Vec3 = [p[0], d.height, p[1]];
      const e: Vec3 = [p[0], 0, p[1]];
      innerSink.quad(a, b, c, e);
      innerSink.quad(e, c, b, a);
    };
    jamb(d.t0);
    jamb(d.t1);
    const o0 = edgePoint(outerPts, d.edge, d.t0);
    const o1 = edgePoint(outerPts, d.edge, d.t1);
    const p0 = edgePoint(innerPts, d.edge, d.t0);
    const p1 = edgePoint(innerPts, d.edge, d.t1);
    const h = d.height;
    innerSink.quad([o0[0], h, o0[1]], [o1[0], h, o1[1]], [p1[0], h, p1[1]], [p0[0], h, p0[1]]);
    innerSink.quad([p0[0], h, p0[1]], [p1[0], h, p1[1]], [o1[0], h, o1[1]], [o0[0], h, o0[1]]);
  }
  const innerShellGeometry = new THREE.BufferGeometry();
  innerShellGeometry.setAttribute("position", new THREE.Float32BufferAttribute(innerSink.positions, 3));
  innerShellGeometry.setAttribute("color", new THREE.Float32BufferAttribute(innerSink.colors, 3));
  innerShellGeometry.computeVertexNormals();
  const innerShellVertices = new Float32Array(innerSink.positions);
  parts.push(innerShellGeometry);

  // ---- Slabs: extruded copies of the interior polygon, slightly oversized
  // so their edges tuck into the prismatic inner shell at every story. ----
  const slabPts = ringPoints(rect, sides, { y: 0, cx: 0, cz: 0, hw: ihw + 0.06, hd: ihd + 0.06 }, phase);
  const slabShape = (holes: { x0: number; z0: number; x1: number; z1: number }[]): THREE.Shape => {
    const shape = new THREE.Shape();
    slabPts.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
    shape.closePath();
    for (const h of holes) {
      const path = new THREE.Path();
      path.moveTo(h.x0, h.z0);
      path.lineTo(h.x1, h.z0);
      path.lineTo(h.x1, h.z1);
      path.lineTo(h.x0, h.z1);
      path.closePath();
      shape.holes.push(path);
    }
    return shape;
  };
  /** Slab occupying y ∈ [yTop − thickness, yTop]. The same (thickness, holes)
   *  profile is requested up to 3× per building (floor layer + ceiling layer
   *  per inter-story slab; top ceiling visual + its collider + the ground
   *  collider), so each profile is extruded/triangulated ONCE and cloned for
   *  the other uses — yTop is the only per-call difference and the translate
   *  is applied identically, so the output geometry is unchanged. */
  const slabGeoCache = new Map<string, THREE.BufferGeometry>();
  const slabGeo = (yTop: number, thickness: number, holes: { x0: number; z0: number; x1: number; z1: number }[]): THREE.BufferGeometry => {
    const key = `${thickness}|${holes.map((h) => `${h.x0},${h.z0},${h.x1},${h.z1}`).join(";")}`;
    let base = slabGeoCache.get(key);
    if (!base) {
      base = new THREE.ExtrudeGeometry(slabShape(holes), { depth: thickness, bevelEnabled: false })
        .rotateX(Math.PI / 2); // shape (x,y) → world (x,z); extrusion ends up downward
      slabGeoCache.set(key, base);
    }
    // Plain BufferGeometry copy (not .clone() — ExtrudeGeometry's clone runs
    // its default-shape constructor first, a wasted triangulation per call).
    return new THREE.BufferGeometry().copy(base).translate(0, yTop, 0);
  };

  // Bottom floor slab — top surface lifted above grade so terrain never
  // z-fights through, reaching below grade so no gap shows at the door sill.
  parts.push(withColor(slabGeo(FLOOR_LIFT, SLAB_THICKNESS + FLOOR_LIFT + 0.4, []), colors.floor));
  slabColliderGeos.push(slabGeo(FLOOR_LIFT, SLAB_THICKNESS, []));

  // Inter-story slabs: floor-colored top layer + ceiling-colored underside,
  // each cut by ITS gap's ramp hole (every gap places its ramp elsewhere).
  for (let s = 1; s < stories; s++) {
    const yTop = s * storyHeight; // story s floor surface
    const holes = ramps.filter((r) => r.story === s - 1).map((r) => r.hole);
    parts.push(withColor(slabGeo(yTop, SLAB_THICKNESS / 2, holes), colors.floor));
    parts.push(withColor(slabGeo(yTop - SLAB_THICKNESS / 2, SLAB_THICKNESS / 2, holes), colors.ceiling));
    slabColliderGeos.push(slabGeo(yTop, SLAB_THICKNESS, holes));
  }

  // Top ceiling (solid)
  const topY = (stories - 1) * storyHeight + ch;
  parts.push(withColor(slabGeo(topY + SLAB_THICKNESS, SLAB_THICKNESS, []), colors.ceiling));
  slabColliderGeos.push(slabGeo(topY + SLAB_THICKNESS, SLAB_THICKNESS, []));

  // Ramp flights: one inclined slab per story gap — the SAME box is the
  // visual (merged into the floor geometry) and the collider, so feet and
  // eyes always agree. Built ascending +x, then yawed to the ramp's axis/dir.
  for (const r of ramps) {
    const run = Math.abs(r.runEnd - r.runStart);
    const theta = Math.atan2(storyHeight, run);
    const hyp = Math.sqrt(run * run + storyHeight * storyHeight);
    const yaw = r.axis === "x" ? (r.dir === 1 ? 0 : Math.PI) : r.dir === 1 ? -Math.PI / 2 : Math.PI / 2;
    const along = (r.runStart + r.runEnd) / 2;
    const lane = (r.lane0 + r.lane1) / 2;
    const cx = r.axis === "x" ? along : lane;
    const cz = r.axis === "x" ? lane : along;
    // sunk slightly so the top surface meets both floors flush
    const cy = r.story * storyHeight + storyHeight / 2 - 0.1;
    parts.push(
      withColor(
        new THREE.BoxGeometry(hyp, RAMP_THICKNESS, RAMP_WIDTH).toNonIndexed().rotateZ(theta).rotateY(yaw).translate(cx, cy, cz),
        colors.ramp,
      ),
    );
    // Euler XYZ applies Z first then Y — same order as the geometry above.
    rampColliders.push({
      position: [cx, cy, cz],
      rotation: [0, yaw, theta],
      halfExtents: [hyp / 2, RAMP_THICKNESS / 2, RAMP_WIDTH / 2],
    });
  }

  // ---- Baked lighting: the interior renders UNLIT (scene light can't reach
  // inside the shell), so a fixed wrap-lambert is baked into the vertex
  // colors — faces pointing different ways get distinct shades, so same-color
  // surfaces still read as separate planes. Zero runtime cost: same single
  // material and draw call. Light panels are added AFTER the bake so they
  // stay full-bright (they read as the light source). ----
  const L = normalize([0.45, 0.8, 0.3]);
  for (const g of parts) {
    const pos = g.getAttribute("position").array as ArrayLike<number>;
    const col = g.getAttribute("color").array as Float32Array;
    for (let i = 0; i + 8 < pos.length; i += 9) {
      const a: Vec3 = [pos[i], pos[i + 1], pos[i + 2]];
      const b: Vec3 = [pos[i + 3], pos[i + 4], pos[i + 5]];
      const c: Vec3 = [pos[i + 6], pos[i + 7], pos[i + 8]];
      const n = normalize(cross(sub(b, a), sub(c, a)));
      const f = 0.62 + 0.38 * ((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) * 0.5 + 0.5);
      for (let k = 0; k < 9; k++) col[i + k] *= f;
    }
  }

  // Ceiling light panels (glowing color baked in; per-story gap pattern)
  for (let s = 0; s < stories; s++) {
    for (const [x, z] of lightPanelsPerStory[s]) {
      // rotateX(π/2) points the plane's +z normal down at the floor
      parts.push(
        withColor(
          new THREE.PlaneGeometry(1.4, 2.8).toNonIndexed().rotateX(Math.PI / 2).translate(x, s * storyHeight + ch - 0.02, z),
          LIGHT_PANEL_COLOR,
        ),
      );
    }
  }

  const interiorGeometry = mergeOrThrow(parts, "interior");
  parts.forEach((g) => g.dispose());

  // Slab colliders as one exact trimesh — box colliders would poke invisible
  // ledges out through polygon shells at the bounding-box corners.
  const slabMerged = mergeOrThrow(slabColliderGeos, "slab colliders");
  slabColliderGeos.forEach((g) => g.dispose());
  const interiorSlabVertices = ((slabMerged.getAttribute("position") as THREE.BufferAttribute).array as Float32Array).slice();
  let interiorSlabIndices: Uint32Array;
  if (slabMerged.index) {
    interiorSlabIndices = Uint32Array.from(slabMerged.index.array as ArrayLike<number>);
  } else {
    interiorSlabIndices = new Uint32Array(interiorSlabVertices.length / 3);
    for (let i = 0; i < interiorSlabIndices.length; i++) interiorSlabIndices[i] = i;
  }
  slabMerged.dispose();
  slabGeoCache.forEach((g) => g.dispose());

  return {
    interiorGeometry,
    interiorColliders,
    rampColliders,
    interiorSlabVertices,
    interiorSlabIndices,
    innerShellVertices,
  };
};

// REFERENCE-COUNTED cache. Cache keys are per-instance seeds and the city
// mounts 300-600 buildings at once, so any capped eviction that ignores
// mounts disposes geometry that is still on a live mesh (the old 64-entry
// FIFO did exactly that, and with a ~0 hit rate re-triangulated constantly).
// Every mounted <Building> retains its entry; eviction only ever touches
// refcount-0 entries (least-recently-released first), capped at MAX_IDLE so
// despawn/respawn churn still gets its O(1) remount.
interface BuildingCacheEntry {
  assets: ProceduralBuildingAssets;
  refCount: number;
  /** Monotonic tick of the last drop to refcount 0 — eviction order. */
  releasedAt: number;
}

const cache = new Map<string, BuildingCacheEntry>();
// Cap on IDLE (refcount 0) entries only — retained entries never count
// against it, so the cache legitimately exceeds this while a dense city
// neighborhood is mounted.
const MAX_IDLE_CACHE = 128;
let releaseTick = 0;

/** Cache-only lookup (no build). Lets <Building> mount instantly for seeds
 *  it has already built (despawn/respawn churn) while NEW seeds build
 *  through the task queue without blocking the spawn frame. */
export const peekProceduralBuildingAssets = (seed: string, optionsKey: string): ProceduralBuildingAssets | null =>
  cache.get(`${seed}|${optionsKey}`)?.assets ?? null;

const disposeAssets = (a: ProceduralBuildingAssets): void => {
  a.exteriorGeometry.dispose();
  a.interiorGeometry.dispose();
  a.doorGeometry.dispose();
};

/** Evict least-recently-released refcount-0 entries down to the idle cap.
 *  Linear scans are fine: the cache tops out around (mounted + MAX_IDLE)
 *  entries and this only runs on insert / on a release to zero. */
const trimIdleEntries = (): void => {
  let idle = 0;
  for (const e of cache.values()) if (e.refCount === 0) idle++;
  while (idle > MAX_IDLE_CACHE) {
    let oldestKey: string | null = null;
    let oldestTick = Infinity;
    for (const [k, e] of cache) {
      if (e.refCount === 0 && e.releasedAt < oldestTick) {
        oldestTick = e.releasedAt;
        oldestKey = k;
      }
    }
    if (oldestKey === null) break;
    disposeAssets(cache.get(oldestKey)!.assets);
    cache.delete(oldestKey);
    idle--;
  }
};

/** Pin a cache entry while a <Building> renders it (mount effect). Passing
 *  the assets closes the render→effect race: a concurrent unmount's release
 *  can trim the just-peeked idle entry before this retain runs, in which
 *  case the same object is re-registered — a disposed BufferGeometry simply
 *  re-uploads on its next draw, so re-pinning it is safe. */
export const retainProceduralBuildingAssets = (seed: string, optionsKey: string, assets: ProceduralBuildingAssets): void => {
  const key = `${seed}|${optionsKey}`;
  const entry = cache.get(key);
  if (entry) {
    entry.refCount++;
  } else {
    cache.set(key, { assets, refCount: 1, releasedAt: releaseTick++ });
  }
};

export const releaseProceduralBuildingAssets = (seed: string, optionsKey: string): void => {
  const entry = cache.get(`${seed}|${optionsKey}`);
  if (!entry || entry.refCount === 0) return;
  entry.refCount--;
  if (entry.refCount === 0) {
    entry.releasedAt = releaseTick++;
    trimIdleEntries();
  }
};

/** The build, split at its natural phase boundaries (plan → exterior →
 *  interior → assembly), each phase meant to run as its OWN task on the build
 *  queue. A monolithic build-it-all call was a single unsplittable task — the
 *  queue's time budget only yields BETWEEN tasks, so a heavy skyscraper
 *  landed as one long frame while roaming. finish() dedupes against the
 *  cache, so a same-seed build that lost a race simply adopts the winner
 *  (partial geometries were never rendered — no GL state to free). */
export const beginProceduralBuildingBuild = (
  seed: string,
  opts: BuildingOptions,
): { steps: Array<() => void>; finish: () => ProceduralBuildingAssets } => {
  let plan: ReturnType<typeof generateBuildingPlan>;
  let ext: ReturnType<typeof buildExteriorGeometry>;
  let interior: ReturnType<typeof buildInteriorGeometries>;
  return {
    steps: [
      () => {
        plan = generateBuildingPlan(seed, opts);
      },
      () => {
        ext = buildExteriorGeometry(plan);
      },
      () => {
        interior = buildInteriorGeometries(plan);
      },
    ],
    finish: () => {
      const key = `${seed}|${JSON.stringify(opts)}`;
      const existing = cache.get(key);
      if (existing) return existing.assets;
      return assembleBuildingAssets(key, plan, ext, interior);
    },
  };
};

const assembleBuildingAssets = (
  key: string,
  plan: ReturnType<typeof generateBuildingPlan>,
  extBuild: ReturnType<typeof buildExteriorGeometry>,
  interiorBuild: ReturnType<typeof buildInteriorGeometries>,
): ProceduralBuildingAssets => {
  const { geometry: exteriorGeometry, bodyFloats } = extBuild;

  // Shell collider = outer body triangles (windows excluded) + the inner
  // shell surface, so the player collides with the wall face they can see
  // from either side.
  const allVerts = (exteriorGeometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
  const exteriorVertices = new Float32Array(bodyFloats + interiorBuild.innerShellVertices.length);
  exteriorVertices.set(allVerts.subarray(0, bodyFloats));
  exteriorVertices.set(interiorBuild.innerShellVertices, bodyFloats);
  const exteriorIndices = new Uint32Array(exteriorVertices.length / 3);
  for (let i = 0; i < exteriorIndices.length; i++) exteriorIndices[i] = i;

  // Door leaf slightly LARGER than the opening (overlapping the jamb and
  // header a little) so no gap ever shows around a closed door; it swings
  // OUTWARD, so no interior-floor clearance is needed. Origin at the hinge
  // edge so rotating the parent group swings it open. Color is seeded per
  // building and baked as vertex colors, like every other building surface.
  const leafW = plan.doors[0].width + 0.16;
  const doorGeometry = withColor(
    new THREE.BoxGeometry(leafW, plan.doors[0].height + 0.2, 0.1).translate(leafW / 2 - 0.08, 0.05, 0),
    plan.doorColor,
  );

  const assets: ProceduralBuildingAssets = {
    plan,
    exteriorGeometry,
    exteriorVertices,
    exteriorIndices,
    interiorGeometry: interiorBuild.interiorGeometry,
    interiorColliders: interiorBuild.interiorColliders,
    rampColliders: interiorBuild.rampColliders,
    interiorSlabVertices: interiorBuild.interiorSlabVertices,
    interiorSlabIndices: interiorBuild.interiorSlabIndices,
    doorGeometry,
    doors: plan.doors.map((d) => ({
      position: d.position,
      yaw: d.yaw,
      width: d.width,
      height: d.height,
    })),
  };

  // Inserted at refcount 0 — the mounting <Building>'s retain effect pins it
  // moments later; a build whose component unmounted before delivery stays
  // idle and ages out normally.
  cache.set(key, { assets, refCount: 0, releasedAt: releaseTick++ });
  trimIdleEntries();
  return assets;
};
