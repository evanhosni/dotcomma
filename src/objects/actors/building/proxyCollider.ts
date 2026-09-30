import { ringPoints } from "./rings";
import { BuildingPlan } from "./types";

// COLLIDER LOD (see CLAUDE.md → Procedural buildings, point 4): beyond the
// collider gate a building is this one SEALED convex hull, so NPCs never walk
// through distant walls. An AABB cuboid was tried instead and removed (a
// rotated square's AABB is ~1.41× wide; NPCs stopped short of facades).

/** The shell's 2D silhouette extruded bottom-to-top — deliberately FATTER
 *  than a hull over the raw corners so it contains a leaning shell at every
 *  height. Rapier QuickHulls its input, so it gets ~14 points, not every
 *  ring corner (~83, worst 133 over 40 seeds). */
export const buildProxyHullVertices = (plan: BuildingPlan): Float32Array => {
  // BODY lofts only: roof caps and pipes would widen the hull into the street.
  const xz: number[][] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < plan.bodyLoftCount; i++) {
    const loft = plan.lofts[i];
    if (!loft) continue;
    for (const level of loft.levels) {
      if (level.y < minY) minY = level.y;
      if (level.y > maxY) maxY = level.y;
      for (const [x, z] of ringPoints(loft.rect, loft.sides, level, loft.ringRotation)) {
        xz.push([x, z]);
      }
    }
  }
  if (xz.length === 0) return new Float32Array(0);

  // A collinear silhouette can't be extruded: hand Rapier the raw cloud instead of nothing.
  const silhouette = convexHull2D(xz);
  const ring = silhouette.length >= 3 ? silhouette : xz;

  const out = new Float32Array(ring.length * 6);
  let o = 0;
  for (const [x, z] of ring) {
    out[o++] = x;
    out[o++] = minY;
    out[o++] = z;
  }
  for (const [x, z] of ring) {
    out[o++] = x;
    out[o++] = maxY;
    out[o++] = z;
  }
  return out;
};

/** Andrew's monotone chain. Deterministic — cached per seed, every client must agree. */
const convexHull2D = (points: number[][]): number[][] => {
  const pts = points.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const halfHull = (input: number[][]): number[][] => {
    const out: number[][] = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop(); // the other half supplies the shared endpoint
    return out;
  };
  return halfHull(pts).concat(halfHull(pts.slice().reverse()));
};

// The body is created and destroyed IMPERATIVELY, never via React state: a
// setState from the frame loop defeats ActorPool's element-identity bailout
// (measured 1–5 fps loss). Hull count is NOT a known cost — an 85% cut in
// live proxies and a 6× cheaper cloud each measured as no fps change.

export interface ProxyColliderHandle {
  dispose: () => void;
}

interface ProxyDeps {
  world: {
    createRigidBody: (desc: any) => any;
    createCollider: (desc: any, body: any) => any;
    removeRigidBody: (body: any) => void;
  };
  rapier: {
    RigidBodyDesc: { fixed: () => any };
    ColliderDesc: { convexHull: (points: Float32Array) => any };
  };
}

/** A tetrahedron. */
const MIN_HULL_POINTS = 4;

const warned = new Set<string>();
const warnOnce = (message: string): void => {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[building] ${message}`);
};

const createSealedHullBody = (
  { world, rapier }: ProxyDeps,
  coordinates: [number, number, number] | Float32Array | number[],
  vertices: Float32Array,
): any => {
  // A missing array makes `convexHull` throw inside the binding, and this runs
  // in a passive effect — the throw would take down the whole React commit.
  if (!vertices || vertices.length < MIN_HULL_POINTS * 3) {
    warnOnce("proxy collider skipped: point cloud missing or degenerate");
    return null;
  }
  const desc = rapier.ColliderDesc.convexHull(vertices);
  if (!desc) {
    warnOnce("proxy collider skipped: Rapier rejected the hull as degenerate");
    return null;
  }

  // A body left behind without its collider panics Rapier's WASM on the later
  // removeRigidBody ("unreachable executed") — unrecoverable.
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.fixed().setTranslation(coordinates[0], coordinates[1], coordinates[2]),
  );
  try {
    world.createCollider(desc, body);
  } catch (e) {
    world.removeRigidBody(body);
    warnOnce(`proxy collider failed to build: ${e}`);
    return null; // one bad building must not kill the commit
  }
  return body;
};

/** Solid the moment the handle exists — never a frame in which the building is passable. */
export const createProxyCollider = (
  deps: ProxyDeps,
  coordinates: [number, number, number] | Float32Array | number[],
  vertices: Float32Array,
): ProxyColliderHandle => {
  let body = createSealedHullBody(deps, coordinates, vertices);

  return {
    dispose: () => {
      if (body) {
        deps.world.removeRigidBody(body);
        body = null;
      }
    },
  };
};
