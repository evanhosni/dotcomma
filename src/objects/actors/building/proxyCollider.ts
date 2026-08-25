import { ringPoints } from "./rings";
import { BuildingPlan } from "./types";

/**
 * The building's PROXY COLLIDER: one convex hull standing in for the whole shell
 * while the real (doored, per-wall) colliders are unmounted.
 *
 * COLLIDER LOD, and a building is NEVER without a collider — only the fidelity
 * changes with distance:
 *
 *   <120u    the real colliders — shell trimesh, interior walls, slabs, ramps,
 *            closed door leaves. Doors work. NOT owned here (mounted as React
 *            children under <RigidBody>).
 *   beyond   this hull. It TRACKS THE FOOTPRINT, so an NPC contacting it reads
 *            as touching the wall.
 *
 * Why anything is here at all: the real colliders can't be everywhere (two
 * trimesh QBVH builds, several ms each, which is why the actor base throttles
 * their activation to one building per 50ms), but NPCs live out to ~243u and
 * used to walk straight through distant walls.
 *
 * A single enclosing AABB cuboid was tried here INSTEAD of the hull and removed:
 * it is Rapier's cheapest shape, but a 45°-rotated square's AABB is ~1.41× its
 * width, so NPCs stopped short of facades and big rotated buildings blocked the
 * sidewalk. The hull's extra construction cost buys a collider that matches what
 * the player sees, and neither shape ever measured as an fps cost.
 *
 * Being convex it has NO door, so it SEALS the building: right at range, and why
 * it is swapped for the real colliders up close where doors must work. The two
 * are mutually exclusive by construction, and the collider gate's hysteresis
 * covers the swap.
 */

/**
 * Build the hull's point cloud in BUILDING-LOCAL space: the shell's 2D
 * SILHOUETTE extruded from its lowest to its highest body level — a prism.
 *
 * Rapier runs its own QuickHull over whatever we hand it, so the input only has
 * to be the extreme points, and the count is a real cost: every building past
 * the collider gate builds one, and the churn as the player crosses the city is
 * continuous. Feeding it every ring corner of every level meant ~83 points
 * (worst 133) when the silhouette that actually determines the hull's ground
 * shadow is ~7 — measured across 40 seeds. So the silhouette is computed HERE,
 * once per seed (cached on the assets), and Rapier gets ~14 points.
 *
 * The prism is deliberately slightly FATTER than a hull over the raw corners:
 * where the shell tapers or leans, the prism keeps the full silhouette at every
 * height instead of narrowing with it. It therefore still contains the shell
 * everywhere (the covering property the tests assert), it seals at least as
 * well, and it costs fewer faces. The overhang is a couple of units on a leaning
 * shell, 120u+ away from the camera — an NPC contacting it reads as touching the
 * wall.
 */
export const buildProxyHullVertices = (plan: BuildingPlan): Float32Array => {
  // BODY lofts only: lofts[0] is the ground door band and lofts[1..
  // bodyLoftCount-1] are the stacked masses. Everything above that is roof caps
  // and pipes — decorative, and nothing walks into them, so letting them widen
  // the hull would just block NPCs further out in the street.
  const xz: number[][] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < plan.bodyLoftCount; i++) {
    const loft = plan.lofts[i];
    if (!loft) continue;
    for (const level of loft.levels) {
      if (level.y < minY) minY = level.y;
      if (level.y > maxY) maxY = level.y;
      for (const [x, z] of ringPoints(loft.rect, loft.sides, level, loft.phase)) {
        xz.push([x, z]);
      }
    }
  }
  if (xz.length === 0) return new Float32Array(0);

  // A degenerate silhouette (collinear rings) can't be extruded into a solid —
  // hand Rapier the raw cloud and let it decide rather than emit no collider.
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

/** Andrew's monotone chain. Deterministic (a total order on the points), which
 *  the hull must be — it's cached per seed and every client must agree. */
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
    out.pop(); // the shared endpoint — the other half supplies it
    return out;
  };
  return halfHull(pts).concat(halfHull(pts.slice().reverse()));
};

// ── The live collider ───────────────────────────────────────────────────────
// Every proxy is owned by one of these handles, created per building. The Rapier
// body is created and destroyed IMPERATIVELY through it, never via React state:
// a setState from the frame loop re-renders that Building, which defeats
// ActorPool's element-identity bailout (it hands back cached elements so
// unchanged buildings never reconcile) — measured as a 1–5 fps LOSS on its own,
// worse than the work it was gating.
//
// Proxies are ALWAYS on; there is no runtime switch. A dev toggle that flipped
// every live one in a single frame lived here for measurement and was removed
// once the answer was in: an 85% cut in the number of live proxies and a 6×
// cheaper point cloud were EACH measured as no fps change, so there is nothing
// to trade away by keeping them.

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

/** Smallest point count that can bound a solid (a tetrahedron). */
const MIN_HULL_POINTS = 4;

// Hundreds of buildings share every failure mode, so the console gets one line
// per distinct message, not one per building.
const warned = new Set<string>();
const warnOnce = (message: string): void => {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[building] ${message}`);
};

/** The fixed body carrying the hull, or null if this building can't have one. */
const buildProxyBody = (
  { world, rapier }: ProxyDeps,
  coordinates: [number, number, number] | Float32Array | number[],
  vertices: Float32Array,
): any => {
  // Validate the cloud BEFORE Rapier sees it. `convexHull` reads `.length` off
  // its argument, so a missing array throws a TypeError from inside the binding
  // rather than returning null — and this runs in a passive effect, so the throw
  // takes down the whole React commit, not just this building. A stale hot-update
  // asset cache (an entry built before this field existed) is exactly how that
  // happens in dev.
  if (!vertices || vertices.length < MIN_HULL_POINTS * 3) {
    warnOnce("proxy collider skipped: point cloud missing or degenerate");
    return null;
  }
  const desc = rapier.ColliderDesc.convexHull(vertices);
  if (!desc) {
    warnOnce("proxy collider skipped: Rapier rejected the hull as degenerate");
    return null;
  }

  // The body is returned only once it actually HAS its collider. Publishing it
  // first meant a throw from createCollider left a body with no collider behind,
  // and the later removeRigidBody on it panics inside Rapier's WASM
  // ("unreachable executed" out of rbNumColliders) — unrecoverable, and one per
  // unmounting building.
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.fixed().setTranslation(coordinates[0], coordinates[1], coordinates[2]),
  );
  try {
    world.createCollider(desc, body);
  } catch (e) {
    world.removeRigidBody(body);
    warnOnce(`proxy collider failed to build: ${e}`);
    return null; // deliberately not rethrown — one bad building must not kill the commit
  }
  return body;
};

export const createProxyCollider = (
  deps: ProxyDeps,
  coordinates: [number, number, number] | Float32Array | number[],
  vertices: Float32Array,
): ProxyColliderHandle => {
  // Built right here, so the building is solid the moment its handle exists —
  // never a frame in which it is passable.
  let body = buildProxyBody(deps, coordinates, vertices);

  return {
    dispose: () => {
      if (body) {
        deps.world.removeRigidBody(body); // removes its colliders too
        body = null;
      }
    },
  };
};
