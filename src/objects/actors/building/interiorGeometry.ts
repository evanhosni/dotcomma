import * as THREE from "three";
import { bakeVertexColor, cross, mergeOrThrow, normalize, sub, TriangleSink, wallBoxGeometry, type Vec3 } from "./buildingGeometry";
import { emitLoft } from "./exteriorGeometry";
import { FLOOR_LIFT, RAMP_THICKNESS, RAMP_WIDTH, SLAB_THICKNESS } from "./generatePlan";
import { edgePoint, ringPoints } from "./rings";
import { BuildingPlan, ExteriorLoft, RampSpec, WallBox } from "./types";

// The interior from one plan: the colliders every building needs from spawn on, and the merged mesh
// built only once the player comes close — so the two cannot disagree.

export interface RampCollider {
  position: Vec3;
  rotation: Vec3;
  halfExtents: Vec3;
}

const LIGHT_PANEL_COLOR = 0xfff7d6;

type SlabHole = { x0: number; z0: number; x1: number; z1: number };

/** Every story's wall/pillar boxes, lifted to the story's height. */
const storyWallBoxes = (plan: BuildingPlan): WallBox[] => {
  const { stories, storyHeight, wallBoxesPerStory } = plan.interior;
  const boxes: WallBox[] = [];
  for (let s = 0; s < stories; s++) {
    const yOff = s * storyHeight;
    for (const b of wallBoxesPerStory[s]) boxes.push({ ...b, cy: b.cy + yOff });
  }
  return boxes;
};

/** The inner shell surface: a straight PRISM of the interior polygon (the outer shell leans/tapers
 *  around it), so split walls meet it exactly at every story — plus the door reveals closing the wall
 *  cavity around each opening (double-faced jambs + header). */
const buildInnerShell = (plan: BuildingPlan): TriangleSink => {
  const { width, depth, stories, storyHeight, colors } = plan.interior;
  const { rect, sides, ringRotation: phase } = plan.lofts[0];
  const interiorHalfWidth = width / 2;
  const interiorHalfDepth = depth / 2;
  const interiorTop = stories * storyHeight + 0.5;
  const doorH = plan.doors[0].height;
  const innerLoft: ExteriorLoft = {
    rect,
    sides,
    ringRotation: phase,
    color: colors.wall,
    hasRoofFan: false,
    levels: [
      { y: -0.6, cx: 0, cz: 0, halfWidth: interiorHalfWidth, halfDepth: interiorHalfDepth },
      { y: doorH + 1, cx: 0, cz: 0, halfWidth: interiorHalfWidth, halfDepth: interiorHalfDepth },
      { y: interiorTop, cx: 0, cz: 0, halfWidth: interiorHalfWidth, halfDepth: interiorHalfDepth },
    ],
  };
  const sink = new TriangleSink();
  emitLoft(sink, innerLoft, plan.doors, { flip: true, color: colors.wall });

  const band = plan.lofts[0];
  const outerPts = ringPoints(band.rect, band.sides, band.levels[0], band.ringRotation);
  const innerPts = ringPoints(rect, sides, innerLoft.levels[0], phase);
  for (const d of plan.doors) {
    const jamb = (t: number): void => {
      const o = edgePoint(outerPts, d.edge, t);
      const p = edgePoint(innerPts, d.edge, t);
      const a: Vec3 = [o[0], 0, o[1]];
      const b: Vec3 = [o[0], d.height, o[1]];
      const c: Vec3 = [p[0], d.height, p[1]];
      const e: Vec3 = [p[0], 0, p[1]];
      sink.quad(a, b, c, e);
      sink.quad(e, c, b, a);
    };
    jamb(d.t0);
    jamb(d.t1);
    const o0 = edgePoint(outerPts, d.edge, d.t0);
    const o1 = edgePoint(outerPts, d.edge, d.t1);
    const p0 = edgePoint(innerPts, d.edge, d.t0);
    const p1 = edgePoint(innerPts, d.edge, d.t1);
    const h = d.height;
    sink.quad([o0[0], h, o0[1]], [o1[0], h, o1[1]], [p1[0], h, p1[1]], [p0[0], h, p0[1]]);
    sink.quad([p0[0], h, p0[1]], [p1[0], h, p1[1]], [o1[0], h, o1[1]], [o0[0], h, o0[1]]);
  }
  return sink;
};

/** Floor slabs over the interior polygon, slightly oversized so their edges tuck into the inner shell.
 *  `make` returns a slab occupying y ∈ [yTop − thickness, yTop]; each (thickness, holes) profile is
 *  triangulated ONCE and copied — it's requested up to 3× per building. */
const createSlabFactory = (plan: BuildingPlan) => {
  const { width, depth } = plan.interior;
  const { rect, sides, ringRotation: phase } = plan.lofts[0];
  const slabPts = ringPoints(rect, sides, { y: 0, cx: 0, cz: 0, halfWidth: width / 2 + 0.06, halfDepth: depth / 2 + 0.06 }, phase);
  const slabShape = (holes: SlabHole[]): THREE.Shape => {
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
  const profiles = new Map<string, THREE.BufferGeometry>();
  return {
    make: (yTop: number, thickness: number, holes: SlabHole[]): THREE.BufferGeometry => {
      const key = `${thickness}|${holes.map((h) => `${h.x0},${h.z0},${h.x1},${h.z1}`).join(";")}`;
      let base = profiles.get(key);
      if (!base) {
        base = new THREE.ExtrudeGeometry(slabShape(holes), { depth: thickness, bevelEnabled: false })
          .rotateX(Math.PI / 2); // shape (x,y) → world (x,z); extrusion ends up downward
        profiles.set(key, base);
      }
      // Not .clone(): ExtrudeGeometry's clone re-runs its constructor — a wasted triangulation.
      return new THREE.BufferGeometry().copy(base).translate(0, yTop, 0);
    },
    dispose: () => profiles.forEach((g) => g.dispose()),
  };
};

/** Holes in story `s`'s floor: the ramps climbing into it. */
const floorHolesOf = (plan: BuildingPlan, s: number): SlabHole[] =>
  plan.interior.ramps.filter((r) => r.story === s - 1).map((r) => r.hole);

/** Top of the topmost ceiling slab's underside. */
const topCeilingY = (plan: BuildingPlan): number =>
  (plan.interior.stories - 1) * plan.interior.storyHeight + plan.interior.ceilingHeight;

/** The ONE box a ramp is — its visual and its collider: built ascending +x, pitched by `theta`, then
 *  yawed (Euler XYZ applies Z then Y, the same order as the geometry). */
const rampPoseOf = (r: RampSpec, storyHeight: number) => {
  const run = Math.abs(r.runEnd - r.runStart);
  const along = (r.runStart + r.runEnd) / 2;
  const lane = (r.lane0 + r.lane1) / 2;
  return {
    theta: Math.atan2(storyHeight, run),
    length: Math.sqrt(run * run + storyHeight * storyHeight),
    yaw: r.axis === "x" ? (r.dir === 1 ? 0 : Math.PI) : r.dir === 1 ? -Math.PI / 2 : Math.PI / 2,
    cx: r.axis === "x" ? along : lane,
    cy: r.story * storyHeight + storyHeight / 2 - 0.1, // sunk so the top meets both floors flush
    cz: r.axis === "x" ? lane : along,
  };
};

/** What the building needs from spawn on: the wall cuboids, the ramp boxes, one exact slab trimesh and
 *  the inner shell the exterior trimesh closes with. */
export const buildInteriorColliders = (plan: BuildingPlan) => {
  const { stories, storyHeight, ramps } = plan.interior;
  const interiorColliders = storyWallBoxes(plan);
  const innerShellVertices = new Float32Array(buildInnerShell(plan).positions);

  const slabs = createSlabFactory(plan);
  const slabGeos: THREE.BufferGeometry[] = [slabs.make(FLOOR_LIFT, SLAB_THICKNESS, [])];
  for (let s = 1; s < stories; s++) slabGeos.push(slabs.make(s * storyHeight, SLAB_THICKNESS, floorHolesOf(plan, s)));
  slabGeos.push(slabs.make(topCeilingY(plan) + SLAB_THICKNESS, SLAB_THICKNESS, []));

  const rampColliders: RampCollider[] = ramps.map((r) => {
    const pose = rampPoseOf(r, storyHeight);
    return {
      position: [pose.cx, pose.cy, pose.cz],
      rotation: [0, pose.yaw, pose.theta],
      halfExtents: [pose.length / 2, RAMP_THICKNESS / 2, RAMP_WIDTH / 2],
    };
  });

  // One exact trimesh: box colliders poked invisible ledges through polygon shells.
  const slabMerged = mergeOrThrow(slabGeos, "slab colliders");
  slabGeos.forEach((g) => g.dispose());
  const interiorSlabVertices = ((slabMerged.getAttribute("position") as THREE.BufferAttribute).array as Float32Array).slice();
  let interiorSlabIndices: Uint32Array;
  if (slabMerged.index) {
    interiorSlabIndices = Uint32Array.from(slabMerged.index.array as ArrayLike<number>);
  } else {
    interiorSlabIndices = new Uint32Array(interiorSlabVertices.length / 3);
    for (let i = 0; i < interiorSlabIndices.length; i++) interiorSlabIndices[i] = i;
  }
  slabMerged.dispose();
  slabs.dispose();

  return { interiorColliders, rampColliders, interiorSlabVertices, interiorSlabIndices, innerShellVertices };
};

/** Baked wrap-lambert: the interior renders unlit, so this is what makes same-color planes read as
 *  separate. */
const INTERIOR_LIGHT_DIR = normalize([0.45, 0.8, 0.3]);
const bakeInteriorShading = (parts: THREE.BufferGeometry[]): void => {
  const L = INTERIOR_LIGHT_DIR;
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
};

/** Walls, the inner shell, slabs, ramps and light panels as ONE merged vertex-colored mesh — built only
 *  once the player comes close (Building.tsx), in the phases below. Reads the same plan as the colliders,
 *  so they cannot disagree. All parts are non-indexed so the merge succeeds. */
export const addInteriorWalls = (plan: BuildingPlan, parts: THREE.BufferGeometry[]): void => {
  for (const wb of storyWallBoxes(plan)) parts.push(bakeVertexColor(wallBoxGeometry(wb).toNonIndexed(), plan.interior.colors.wall));

  const innerShell = buildInnerShell(plan);
  const innerShellGeometry = new THREE.BufferGeometry();
  innerShellGeometry.setAttribute("position", new THREE.Float32BufferAttribute(innerShell.positions, 3));
  innerShellGeometry.setAttribute("color", new THREE.Float32BufferAttribute(innerShell.colors, 3));
  innerShellGeometry.computeVertexNormals();
  parts.push(innerShellGeometry);
};

export const addInteriorSlabsAndRamps = (plan: BuildingPlan, parts: THREE.BufferGeometry[]): void => {
  const { stories, storyHeight, ramps, colors } = plan.interior;
  const slabs = createSlabFactory(plan);
  // Ground slab: lifted above grade so terrain can't z-fight through, reaching below grade so the sill shows no gap.
  parts.push(bakeVertexColor(slabs.make(FLOOR_LIFT, SLAB_THICKNESS + FLOOR_LIFT + 0.4, []), colors.floor));
  for (let s = 1; s < stories; s++) {
    const yTop = s * storyHeight;
    const holes = floorHolesOf(plan, s);
    parts.push(bakeVertexColor(slabs.make(yTop, SLAB_THICKNESS / 2, holes), colors.floor));
    parts.push(bakeVertexColor(slabs.make(yTop - SLAB_THICKNESS / 2, SLAB_THICKNESS / 2, holes), colors.ceiling));
  }
  parts.push(bakeVertexColor(slabs.make(topCeilingY(plan) + SLAB_THICKNESS, SLAB_THICKNESS, []), colors.ceiling));

  for (const r of ramps) {
    const pose = rampPoseOf(r, storyHeight);
    parts.push(
      bakeVertexColor(
        new THREE.BoxGeometry(pose.length, RAMP_THICKNESS, RAMP_WIDTH)
          .toNonIndexed()
          .rotateZ(pose.theta)
          .rotateY(pose.yaw)
          .translate(pose.cx, pose.cy, pose.cz),
        colors.ramp,
      ),
    );
  }

  slabs.dispose();
};

/** The baked shading over every part so far, then the light panels — added AFTER it: they stay full-bright. */
export const shadeInteriorAndAddPanels = (plan: BuildingPlan, parts: THREE.BufferGeometry[]): void => {
  const { stories, storyHeight, ceilingHeight: ch, lightPanelsPerStory } = plan.interior;
  bakeInteriorShading(parts);
  for (let s = 0; s < stories; s++) {
    for (const [x, z] of lightPanelsPerStory[s]) {
      parts.push(
        bakeVertexColor(
          new THREE.PlaneGeometry(1.4, 2.8).toNonIndexed().rotateX(Math.PI / 2).translate(x, s * storyHeight + ch - 0.02, z),
          LIGHT_PANEL_COLOR,
        ),
      );
    }
  }
};

export const mergeInteriorParts = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const interiorGeometry = mergeOrThrow(parts, "interior");
  parts.forEach((g) => g.dispose());
  return interiorGeometry;
};
