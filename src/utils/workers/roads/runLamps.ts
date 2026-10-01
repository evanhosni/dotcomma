/**
 * Street lamps along the inter-city freeway RUNS (the FreewayLamps dressing): both sides of every
 * run, STAGGERED — each side on its own arc lattice `spacing` apart, the far side half a period
 * behind — on the verge just past the painted shoulder, arm over the road; where the verge lies on
 * the grade's cut/fill ramp (a hillside), on the shoulder paint instead. Deterministic and
 * duplicate-free under chunked queries: the lattice is the run's own arc length (identical from
 * every chunk, like getFreewayRunMarkers) and a lamp belongs to the chunk holding its final world
 * position.
 */

import { CITY_BIOME_ID } from "../../../world/constants";
import { FREEWAY_CORRIDOR_INNER, FREEWAY_CORRIDOR_OUTER } from "../../../world/shaders/constants";
import { domainConfig } from "../computeConfig";
import { unwarp, warp } from "../noise";
import { riverKeepOff } from "../rivers/riverNetwork";
import { computeVertexData } from "../vertexCompute";
import { distanceToWall, getBiomeContext, cityWallsOf } from "../voronoi";
import { type FreewayRun, freewayPointAt, getNetwork } from "./freewayNetwork";

export interface FreewayLampParams {
  /** Between two lamps on ONE side (real arc units); the other side is offset by half of it. */
  spacing: number;
  /** Past the painted corridor's outer edge (FREEWAY_CORRIDOR_OUTER), real units: where a lamp stands. */
  verge: number;
  /** Past the corridor's INNER edge (FREEWAY_CORRIDOR_INNER — the curb strip's outer edge), real units:
   *  the fallback on the painted shoulder where the verge lies on the grade's cut or fill ramp. */
  shoulder: number;
  /** No lamp within this arc of a run's end (a hub, or the belt corner a run leaves from). */
  endClear: number;
  /** No lamp within this of a city wall (the belt's centerline) — the city's own lamps take over. */
  beltClear: number;
  /** A lamp's ground within this of the road's (a verge on an embankment or in a cut is not a verge). */
  maxRise: number;
  /** Steepest ground a pole is planted on (degrees). */
  maxSlope: number;
}

export interface FreewayLampPoint {
  x: number;
  y: number;
  z: number;
  /** Local +X (the arm) toward the road. */
  yaw: number;
}

/** The lateral offset is solved so the lamp stands at the TARGET road-field distance: the road is
 *  measured from a meandered point (±3u), so a fixed offset from the polyline would wander on and off
 *  the curb. */
const LATERAL_ITERATIONS = 4;
const LATERAL_TOLERANCE = 0.75;
/** An offset that moved further than this from the nominal one found another road's verge. */
const LATERAL_DRIFT_MAX = 6;
/** How far outside the chunk a first guess may land and still be solved into it. */
const SOLVE_SLACK = LATERAL_DRIFT_MAX + 2;
/** A bridge deck's landed end carries the road this far past the river's footprint at most; the
 *  road centerline beside a lamp is checked for a deck this far along both ways. */
const DECK_ALONG_CLEAR = 16;
/** Only within this many river footprints of a river can a deck stand nearby. */
const DECK_RIVER_REACH = 3;
/** Slope stencil half-step (real units). */
const SLOPE_STEP = 1.5;
/** A little over the drawn pole's half-width (lampSpec: 0.22): the base sinks by the slope across it. */
const POLE_SINK_RADIUS = 0.15;

/** Why OWNED candidates were dropped, by reason (probes and tests read it; never reset here). */
export const runLampDebug: Record<string, number> = {};
const reject = (reason: string): null => {
  runLampDebug[reason] = (runLampDebug[reason] ?? 0) + 1;
  return null;
};

export function getFreewayRunLamps(minX: number, minZ: number, maxX: number, maxZ: number, p: FreewayLampParams): FreewayLampPoint[] {
  if (!domainConfig) return [];
  const city = domainConfig.cityConfig;
  const toReal = city.freewayWidth / city.roadWidth;
  const vergeAt = FREEWAY_CORRIDOR_OUTER * toReal + p.verge;
  const shoulderAt = FREEWAY_CORRIDOR_INNER * toReal + p.shoulder;
  const keepOff = riverKeepOff();
  const maxGrad = Math.tan((p.maxSlope * Math.PI) / 180);

  // The chunk in warped space (the runs' space), padded by the lamp's reach.
  let wMinX = Infinity;
  let wMinZ = Infinity;
  let wMaxX = -Infinity;
  let wMaxZ = -Infinity;
  for (const [x, z] of [[minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ]]) {
    const w = warp(x, z);
    wMinX = Math.min(wMinX, w.x);
    wMaxX = Math.max(wMaxX, w.x);
    wMinZ = Math.min(wMinZ, w.z);
    wMaxZ = Math.max(wMaxZ, w.z);
  }
  const pad = vergeAt + LATERAL_DRIFT_MAX + 16;
  wMinX -= pad;
  wMinZ -= pad;
  wMaxX += pad;
  wMaxZ += pad;

  const owns = (x: number, z: number) => x >= minX && x < maxX && z >= minZ && z < maxZ;
  const out: FreewayLampPoint[] = [];

  /** Where the lateral solve for one target distance lands, or why it failed. */
  type Placed = { x: number; z: number; wx: number; wz: number; vd: ReturnType<typeof computeVertexData> } | string;
  const solve = (cx: number, cz: number, nx: number, nz: number, target: number): Placed => {
    let lateral = target;
    let wx = 0;
    let wz = 0;
    let pos = { x: 0, z: 0 };
    let vd: ReturnType<typeof computeVertexData> | null = null;
    let err = Infinity;
    for (let it = 0; it < LATERAL_ITERATIONS; it++) {
      wx = cx + nx * lateral;
      wz = cz + nz * lateral;
      pos = unwarp(wx, wz);
      vd = computeVertexData(pos.x, pos.z);
      if (vd.biomeId === CITY_BIOME_ID || vd.distanceToRoadCenter > 90000) return "city";
      err = target - vd.distanceToRoadCenter * toReal;
      if (Math.abs(err) < LATERAL_TOLERANCE) break;
      lateral += err;
    }
    if (!vd || Math.abs(err) >= LATERAL_TOLERANCE || Math.abs(lateral - target) > LATERAL_DRIFT_MAX) return "verge";
    // Water: rivers (channel + banks) and lakes.
    if (vd.distanceToRiverCenter < keepOff || vd.underDeck > 0) return "river";
    if (!Number.isNaN(vd.waterHeight) && vd.waterHeight > vd.height - 0.25) return "water";
    return { x: pos.x, z: pos.z, wx, wz, vd };
  };

  const candidate = (run: FreewayRun, i: number, s: number, side: number): FreewayLampPoint | null => {
    const pts = run.pts;
    const ax = pts[i * 2];
    const az = pts[i * 2 + 1];
    const segLen = run.cum[i + 1] - run.cum[i];
    const ux = (pts[i * 2 + 2] - ax) / segLen;
    const uz = (pts[i * 2 + 3] - az) / segLen;
    const cx = ax + ux * (s - run.cum[i]);
    const cz = az + uz * (s - run.cum[i]);
    // Left normal of the tangent, flipped by side.
    const nx = -uz * side;
    const nz = ux * side;
    // Cheap ownership before any height: every placement lands within a few units of the verge guess.
    const guess = unwarp(cx + nx * vergeAt, cz + nz * vergeAt);
    if (!(guess.x >= minX - SOLVE_SLACK && guess.x < maxX + SOLVE_SLACK && guess.z >= minZ - SOLVE_SLACK && guess.z < maxZ + SOLVE_SLACK)) return null;
    // Every decision below is a pure function of the candidate: ownership is by the FINAL position,
    // and a failed candidate is counted by the chunk holding its verge guess.
    const fail = (reason: string) => (owns(guess.x, guess.z) ? reject(reason) : null);

    // The road beside it: drawn, painted (no merge mouth, no lane end before an undecked river), no deck.
    const c = unwarp(cx, cz);
    const road = computeVertexData(c.x, c.z);
    if (road.biomeId === CITY_BIOME_ID || road.underDeck > 0 || road.distanceToRoadCenter > 2 || road.distanceToFreewayCenter > 99990) return fail("road");
    if (road.distanceToRiverCenter < keepOff * DECK_RIVER_REACH) {
      for (const ds of [-DECK_ALONG_CLEAR, DECK_ALONG_CLEAR]) {
        const q = freewayPointAt(run, s + ds);
        const qw = unwarp(q.x, q.z);
        if (computeVertexData(qw.x, qw.z).underDeck > 0) return fail("deck");
      }
    }

    let reason = "";
    for (const target of [vergeAt, shoulderAt]) {
      const at = solve(cx, cz, nx, nz, target);
      if (typeof at === "string") {
        reason = at;
        continue;
      }
      // The belt, and the mouth where the run merges into it.
      if (distanceToWall(at.wx, at.wz, cityWallsOf(getBiomeContext({ x: at.wx, z: at.wz }))) < p.beltClear) {
        reason = "belt";
        continue;
      }
      if (Math.abs(at.vd.height - road.height) > p.maxRise) {
        reason = "rise";
        continue;
      }
      const hx0 = computeVertexData(at.x - SLOPE_STEP, at.z).height;
      const hx1 = computeVertexData(at.x + SLOPE_STEP, at.z).height;
      const hz0 = computeVertexData(at.x, at.z - SLOPE_STEP).height;
      const hz1 = computeVertexData(at.x, at.z + SLOPE_STEP).height;
      const grad = Math.hypot(hx1 - hx0, hz1 - hz0) / (2 * SLOPE_STEP);
      if (grad > maxGrad) {
        reason = "slope";
        continue;
      }
      if (!owns(at.x, at.z)) return null;
      if (target === shoulderAt) runLampDebug.shoulder = (runLampDebug.shoulder ?? 0) + 1;
      // Sunk by the slope across the pole's footprint, so no side of its base floats.
      return { x: at.x, y: at.vd.height - grad * POLE_SINK_RADIUS, z: at.z, yaw: Math.atan2(-(c.z - at.z), c.x - at.x) };
    }
    return fail(reason);
  };

  for (const run of getNetwork(warp((minX + maxX) / 2, (minZ + maxZ) / 2)).freeways) {
    if (run.maxX < wMinX || run.minX > wMaxX || run.maxZ < wMinZ || run.minZ > wMaxZ) continue;
    const pts = run.pts;
    for (let i = 0; i + 1 < run.cum.length; i++) {
      const s0 = run.cum[i];
      const s1 = run.cum[i + 1];
      if (s1 - s0 < 1e-6) continue;
      const ax = pts[i * 2];
      const az = pts[i * 2 + 1];
      const bx = pts[i * 2 + 2];
      const bz = pts[i * 2 + 3];
      if (Math.max(ax, bx) < wMinX || Math.min(ax, bx) > wMaxX || Math.max(az, bz) < wMinZ || Math.min(az, bz) > wMaxZ) continue;
      for (const side of [1, -1]) {
        const offset = side === 1 ? p.spacing / 4 : (3 * p.spacing) / 4;
        for (let s = Math.ceil((s0 - offset) / p.spacing) * p.spacing + offset; s < s1; s += p.spacing) {
          if (s < s0 || s < p.endClear || s > run.length - p.endClear) continue;
          const lamp = candidate(run, i, s, side);
          if (lamp) out.push(lamp);
        }
      }
    }
  }
  return out;
}
