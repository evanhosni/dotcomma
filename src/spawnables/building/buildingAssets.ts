import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { FLOOR_LIFT, generateBuildingPlan, RAMP_THICKNESS, RAMP_WIDTH, SLAB_THICKNESS } from "./generatePlan";
import { edgeLength, edgePoint, interpRing, ringPoints } from "./rings";
import { BuildingOptions, BuildingPlan, DoorPlan, ExteriorLoft, WallBox, WindowSpec } from "./types";

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

/** mergeGeometries returns null when inputs have mismatched attributes or
 *  mixed indexed/non-indexed — fail loudly instead of caching a null. */
const mergeOrThrow = (geos: THREE.BufferGeometry[], label: string): THREE.BufferGeometry => {
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error(`Building geometry merge failed: ${label}`);
  return merged;
};

const buildInteriorGeometries = (plan: BuildingPlan) => {
  const { width, depth, ceilingHeight: ch, stories, storyHeight, wallBoxesPerStory, ramp, lightPanelsPerStory } = plan.interior;
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
  const slabShape = (withHole: boolean): THREE.Shape => {
    const shape = new THREE.Shape();
    slabPts.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
    shape.closePath();
    if (withHole && ramp) {
      const h = ramp.hole;
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
  /** Slab occupying y ∈ [yTop − thickness, yTop]. */
  const slabGeo = (yTop: number, thickness: number, withHole: boolean): THREE.BufferGeometry =>
    new THREE.ExtrudeGeometry(slabShape(withHole), { depth: thickness, bevelEnabled: false })
      .rotateX(Math.PI / 2) // shape (x,y) → world (x,z); extrusion ends up downward
      .translate(0, yTop, 0);

  // Bottom floor slab — top surface lifted above grade so terrain never
  // z-fights through, reaching below grade so no gap shows at the door sill.
  parts.push(withColor(slabGeo(FLOOR_LIFT, SLAB_THICKNESS + FLOOR_LIFT + 0.4, false), colors.floor));
  slabColliderGeos.push(slabGeo(FLOOR_LIFT, SLAB_THICKNESS, false));

  // Inter-story slabs (with the ramp-shaft hole): floor-colored top layer +
  // ceiling-colored underside.
  for (let s = 1; s < stories; s++) {
    const yTop = s * storyHeight; // story s floor surface
    parts.push(withColor(slabGeo(yTop, SLAB_THICKNESS / 2, true), colors.floor));
    parts.push(withColor(slabGeo(yTop - SLAB_THICKNESS / 2, SLAB_THICKNESS / 2, true), colors.ceiling));
    slabColliderGeos.push(slabGeo(yTop, SLAB_THICKNESS, true));
  }

  // Top ceiling (solid)
  const topY = (stories - 1) * storyHeight + ch;
  parts.push(withColor(slabGeo(topY + SLAB_THICKNESS, SLAB_THICKNESS, false), colors.ceiling));
  slabColliderGeos.push(slabGeo(topY + SLAB_THICKNESS, SLAB_THICKNESS, false));

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
      parts.push(
        withColor(
          new THREE.BoxGeometry(hyp, RAMP_THICKNESS, RAMP_WIDTH).toNonIndexed().rotateZ(theta).translate(cx, cy, cz),
          colors.ramp,
        ),
      );
      rampColliders.push({
        position: [cx, cy, cz],
        rotation: [0, 0, theta],
        halfExtents: [hyp / 2, RAMP_THICKNESS / 2, RAMP_WIDTH / 2],
      });
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

  return {
    interiorGeometry,
    interiorColliders,
    rampColliders,
    interiorSlabVertices,
    interiorSlabIndices,
    innerShellVertices,
  };
};

const cache = new Map<string, ProceduralBuildingAssets>();
const MAX_CACHE = 64;

const disposeAssets = (a: ProceduralBuildingAssets): void => {
  a.exteriorGeometry.dispose();
  a.interiorGeometry.dispose();
  a.doorGeometry.dispose();
};

export const getProceduralBuildingAssets = (seed: string, opts: BuildingOptions): ProceduralBuildingAssets => {
  const key = `${seed}|${JSON.stringify(opts)}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const plan = generateBuildingPlan(seed, opts);

  const { geometry: exteriorGeometry, bodyFloats } = buildExteriorGeometry(plan);
  const interiorBuild = buildInteriorGeometries(plan);

  // Shell collider = outer body triangles (windows excluded) + the inner
  // shell surface, so the player collides with the wall face they can see
  // from either side.
  const allVerts = (exteriorGeometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
  const exteriorVertices = new Float32Array(bodyFloats + interiorBuild.innerShellVertices.length);
  exteriorVertices.set(allVerts.subarray(0, bodyFloats));
  exteriorVertices.set(interiorBuild.innerShellVertices, bodyFloats);
  const exteriorIndices = new Uint32Array(exteriorVertices.length / 3);
  for (let i = 0; i < exteriorIndices.length; i++) exteriorIndices[i] = i;

  // Door leaf slightly smaller than the opening; origin at the hinge edge so
  // rotating the parent group swings it open. Raised so its bottom clears
  // the lifted interior floor (FLOOR_LIFT) when swung inward.
  const leafW = plan.doors[0].width - 0.08;
  const doorGeometry = new THREE.BoxGeometry(leafW, plan.doors[0].height - 0.2, 0.1).translate(
    leafW / 2,
    FLOOR_LIFT - 0.02,
    0,
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
