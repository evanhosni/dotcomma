/** The rules a deck keeps: it crosses a river bank to bank at a steep enough angle, follows no shore
 *  for long, turns no sharper than BRIDGE_MAX_TURN. */

import { distanceToSegment } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { domainConfig } from "../computeConfig";
import { warp } from "../noise";
import { riverFieldAt, riverSample } from "../rivers/riverField";
import { riverWetReach } from "../rivers/constants";
import { riverPieceBuilt, riverPieceEnds, riverPiecesNear } from "../rivers/riverNetwork";
import type { RiverEdge } from "../rivers/types";
import { BRIDGE_ALONG_ALIGN, BRIDGE_MAX_ALONG_SHORE, BRIDGE_MAX_DEVIATION, BRIDGE_MAX_TURN, BRIDGE_MIN_CROSSING, MOUTH_SAMPLE } from "./constants";
import { edgeDirWorld, edgeSide } from "./mouths";
import { dropShortLegs, filletCorners, segIntersect, simplifyPolyline } from "./polyline";
import type { BridgeChain, FreewayBridge, WindowScan } from "./types";

const BRIDGE_TURN_WINDOW = 40;

/** Where a warped polyline crosses the river CENTERLINES (built pieces, each extended by its
 *  half-width so a pond's round end counts): per river edge, the distinct crossings. `odd` = some
 *  river is crossed an odd number of times (bank to bank); `angle` = the smallest crossing angle
 *  (radians, 0 = along the river) among those. */
export const centerlineCrossings = (scan: WindowScan, wx: number[], wz: number[]): { odd: boolean; angle: number; count: number } => {
  const built = (scan.built ??= scan.pieces.filter(riverPieceBuilt));
  const hw = domainConfig!.river.halfWidth;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < wx.length; i++) {
    x0 = Math.min(x0, wx[i]); x1 = Math.max(x1, wx[i]);
    z0 = Math.min(z0, wz[i]); z1 = Math.max(z1, wz[i]);
  }
  const byEdge = new Map<string, { x: number; z: number; angle: number }[]>();
  for (const p of built) {
    const dx = p.ex - p.sx, dz = p.ez - p.sz;
    const l = Math.hypot(dx, dz);
    if (l < 1e-9) continue;
    const ux = dx / l, uz = dz / l;
    const [end0, end1] = riverPieceEnds(p);
    const ax = p.sx - (end0 ? ux * hw * p.w0 : 0), az = p.sz - (end0 ? uz * hw * p.w0 : 0);
    const bx = p.ex + (end1 ? ux * hw * p.w1 : 0), bz = p.ez + (end1 ? uz * hw * p.w1 : 0);
    if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(az, bz) < z0 || Math.min(az, bz) > z1) continue;
    for (let i = 0; i + 1 < wx.length; i++) {
      const hit = segIntersect(wx[i], wz[i], wx[i + 1], wz[i + 1], ax, az, bx, bz);
      if (!hit) continue;
      const lx = wx[i + 1] - wx[i], lz = wz[i + 1] - wz[i];
      const angle = Math.acos(Math.min(1, Math.abs(lx * ux + lz * uz) / (Math.hypot(lx, lz) || 1)));
      let list = byEdge.get(p.edge.key);
      if (!list) byEdge.set(p.edge.key, (list = []));
      if (!list.some((q) => Math.hypot(q.x - hit.x, q.z - hit.z) < 2)) list.push({ x: hit.x, z: hit.z, angle });
    }
  }
  let odd = false, angle = Math.PI / 2, count = 0;
  for (const list of byEdge.values()) {
    count += list.length;
    if (list.length % 2 === 0) continue;
    odd = true;
    for (const q of list) angle = Math.min(angle, q.angle);
  }
  return { odd, angle, count };
};

/** How far a chain runs ALONG a river inside its footprint: the length of its samples within
 *  BRIDGE_ALONG_ALIGN of the nearest built river piece's direction. A crossing that also follows
 *  the bank (a belt rounding a city lobe's tip in the river, then crossing) reads as a zigzag deck
 *  along the shore. */
export const alongShoreLength = (scan: WindowScan, c: BridgeChain): number => {
  const built = (scan.built ??= scan.pieces.filter(riverPieceBuilt));
  const cosAlign = Math.cos(BRIDGE_ALONG_ALIGN);
  let along = 0;
  for (let i = 0; i + 1 < c.wx.length; i++) {
    const dx = c.wx[i + 1] - c.wx[i];
    const dz = c.wz[i + 1] - c.wz[i];
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) continue;
    const mx = (c.wx[i] + c.wx[i + 1]) / 2;
    const mz = (c.wz[i] + c.wz[i + 1]) / 2;
    riverFieldAt(mx, mz, false, false);
    if (!(riverSample.distance < scan.reach)) continue;
    let best = Infinity;
    let ux = 0;
    let uz = 0;
    for (const p of built) {
      const d = distanceToSegment(mx, mz, p.sx, p.sz, p.ex, p.ez);
      if (d >= best) continue;
      best = d;
      const pl = Math.hypot(p.ex - p.sx, p.ez - p.sz) || 1;
      ux = (p.ex - p.sx) / pl;
      uz = (p.ez - p.sz) / pl;
    }
    if (best < Infinity && Math.abs(dx * ux + dz * uz) / l > cosAlign) along += Math.hypot(c.x[i + 1] - c.x[i], c.z[i + 1] - c.z[i]);
  }
  return along;
};

/** The most a chain's direction turns within any BRIDGE_TURN_WINDOW of arc (radians). */
export const sharpestTurn = (c: BridgeChain): number => {
  const p = c.path;
  let worst = 0;
  for (let i = 0; i + 1 < p.length; i++) {
    const ax = p[i + 1].x - p[i].x;
    const az = p[i + 1].z - p[i].z;
    const al = Math.hypot(ax, az) || 1;
    for (let k = i + 1; k + 1 < p.length && c.cum[k] - c.cum[i + 1] < BRIDGE_TURN_WINDOW; k++) {
      const bx = p[k + 1].x - p[k].x;
      const bz = p[k + 1].z - p[k].z;
      const bl = Math.hypot(bx, bz) || 1;
      worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (al * bl)))));
    }
  }
  return worst;
};

/** The sharpest turn a deck along world polyline (x, z) makes once simplified and its corners rounded
 *  as a chain's path is (linkWetItems) — riverNetwork's road layer asks whether a road ending in the
 *  water beside it could tee into its deck (a curve replacing it, smoothKink, leaves the T behind). */
export const deckPathTurn = (x: number[], z: number[]): number => {
  if (x.length < 3) return 0;
  const kept = simplifyPolyline(x, z, BRIDGE_MAX_DEVIATION);
  const path = dropShortLegs(filletCorners(kept.map((i) => ({ x: x[i], z: z[i] }))));
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  return sharpestTurn({ path, cum } as BridgeChain);
};

/** A mouth deck runs at most this far over dry ground from a landed end before it reaches the
 *  river's footprint (a curve leaving a road along the bank would cross the land first). */
const MOUTH_DRY_END = 45;

/** How a deck's centerline crosses the river centerlines (as centerlineCrossings has it): `odd` =
 *  some river crossed bank to bank, `angle` = the shallowest such crossing (radians, 0 = along the
 *  river), `count` = every crossing (tests, probes). */
export const bridgeRiverCrossing = (b: FreewayBridge): { odd: boolean; angle: number; count: number } => {
  const wx: number[] = [];
  const wz: number[] = [];
  for (let i = 0; i < b.path.length; i++) {
    const p = b.path[i];
    const q = b.path[Math.min(b.path.length - 1, i + 1)];
    const n = i + 1 < b.path.length ? Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / MOUTH_SAMPLE)) : 1;
    for (let k = 0; k < n; k++) {
      const w = warp(p.x + ((q.x - p.x) * k) / n, p.z + ((q.z - p.z) * k) / n);
      wx.push(w.x);
      wz.push(w.z);
    }
  }
  const pieces = riverPiecesNear(Math.min(...wx), Math.min(...wz), Math.max(...wx), Math.max(...wz), riverWetReach()).filter(riverPieceBuilt);
  return centerlineCrossings({ pieces, built: pieces } as WindowScan, wx, wz);
};

/** The rules every mouth deck keeps, on its dense curve (world): it turns no sharper than
 *  BRIDGE_MAX_TURN, follows the shore no longer than BRIDGE_MAX_ALONG_SHORE, passes over ONE wet
 *  stretch (never over land between two), runs at most MOUTH_DRY_END over dry ground from its landed
 *  start, and crosses edge e's centerline (within the edge) exactly `crossings` times, at ≥
 *  BRIDGE_MIN_CROSSING — never near parallel to the river. `why` is "" when it keeps them all. */
export const mouthCurveRules = (pts: PointXZ[], e: RiverEdge, landedEnd: boolean, crossings: 0 | 1): { why: string; x: number; z: number } => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const L = cum[cum.length - 1];
  let worst = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i + 1].x - pts[i].x;
    const az = pts[i + 1].z - pts[i].z;
    for (let j = i + 1; j + 1 < pts.length && cum[j] - cum[i + 1] < BRIDGE_TURN_WINDOW; j++) {
      const bx = pts[j + 1].x - pts[j].x;
      const bz = pts[j + 1].z - pts[j].z;
      worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / ((Math.hypot(ax, az) || 1) * (Math.hypot(bx, bz) || 1))))));
    }
  }
  const no = (why: string) => ({ why, x: 0, z: 0 });
  if (worst > BRIDGE_MAX_TURN) return no(`kinked (${Math.round((worst * 180) / Math.PI)}°)`);
  const rv = domainConfig!.river;
  const reach = rv.halfWidth + rv.bank;
  const cosAlign = Math.cos(BRIDGE_ALONG_ALIGN);
  let along = 0;
  let count = 0;
  let cx = 0;
  let cz = 0;
  let angle = Math.PI / 2;
  let wetRuns = 0;
  let wasWet = false;
  let dryStart = -1;
  let side = Math.sign(edgeSide(e, pts[0].x, pts[0].z));
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const mw = warp((p.x + q.x) / 2, (p.z + q.z) / 2);
    riverFieldAt(mw.x, mw.z, false, false);
    const inFoot = riverSample.distance < reach;
    if (inFoot && !wasWet) wetRuns++;
    if (inFoot && dryStart < 0) dryStart = cum[i];
    wasWet = inFoot;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    const rd = edgeDirWorld(e, mw.x, mw.z);
    const cos = Math.abs(dx * rd.x + dz * rd.z) / l;
    if (inFoot && cos > cosAlign) along += l;
    // The centerline: where the curve changes side of the edge — inside the edge's own extent.
    const next = Math.sign(edgeSide(e, q.x, q.z));
    if (next !== side) {
      const s = (mw.x - e.ax) * e.ux + (mw.z - e.az) * e.uz;
      if (s < -rv.halfWidth || s > e.len + rv.halfWidth) return no("crosses beyond the river's edge");
      count++;
      cx = q.x;
      cz = q.z;
      angle = Math.min(angle, Math.acos(Math.min(1, cos)));
      side = next;
    }
  }
  if (count !== crossings) return no(count === 0 ? "along the shore" : crossings === 0 ? "crosses before its trunk" : "crosses twice");
  if (count > 0 && angle < BRIDGE_MIN_CROSSING) return no(`shallow crossing (${Math.round((angle * 180) / Math.PI)}°)`);
  if (along > BRIDGE_MAX_ALONG_SHORE) return no(`along the shore for ${Math.round(along)}u`);
  if (wetRuns !== 1) return no(wetRuns === 0 ? "dry" : "over land mid-span");
  if (landedEnd && dryStart > MOUTH_DRY_END) return no(`over land for ${Math.round(dryStart)}u`);
  if (L < 1) return no("degenerate");
  const built = builtCrossingRule(pts, e, crossings);
  if (built) return no(built);
  return { why: "", x: cx, z: cz };
};

/** Where a world polyline crosses the BUILT river centerlines (each piece extended by its half-width,
 *  as centerlineCrossings has them — the warped line of an edge also runs on where a pond ended it or
 *  a gap cut it): per edge, the crossing angles (radians, warped, 0 = along the river). */
const builtRiverCrossings = (pts: PointXZ[]): Map<string, number[]> => {
  const wx: number[] = [];
  const wz: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[Math.min(pts.length - 1, i + 1)];
    const n = i + 1 < pts.length ? Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / MOUTH_SAMPLE)) : 1;
    for (let k = 0; k < n; k++) {
      const w = warp(p.x + ((q.x - p.x) * k) / n, p.z + ((q.z - p.z) * k) / n);
      wx.push(w.x);
      wz.push(w.z);
    }
  }
  const hw = domainConfig!.river.halfWidth;
  const out = new Map<string, { x: number; z: number; a: number }[]>();
  for (const p of riverPiecesNear(Math.min(...wx), Math.min(...wz), Math.max(...wx), Math.max(...wz), riverWetReach())) {
    if (!riverPieceBuilt(p)) continue;
    const dx = p.ex - p.sx;
    const dz = p.ez - p.sz;
    const l = Math.hypot(dx, dz);
    if (l < 1e-9) continue;
    const ux = dx / l;
    const uz = dz / l;
    const [end0, end1] = riverPieceEnds(p);
    const ax = p.sx - (end0 ? ux * hw * p.w0 : 0);
    const az = p.sz - (end0 ? uz * hw * p.w0 : 0);
    const bx = p.ex + (end1 ? ux * hw * p.w1 : 0);
    const bz = p.ez + (end1 ? uz * hw * p.w1 : 0);
    for (let i = 0; i + 1 < wx.length; i++) {
      const hit = segIntersect(wx[i], wz[i], wx[i + 1], wz[i + 1], ax, az, bx, bz);
      if (!hit) continue;
      const lx = wx[i + 1] - wx[i];
      const lz = wz[i + 1] - wz[i];
      const a = Math.acos(Math.min(1, Math.abs(lx * ux + lz * uz) / (Math.hypot(lx, lz) || 1)));
      let list = out.get(p.edge.key);
      if (!list) out.set(p.edge.key, (list = []));
      if (!list.some((q) => Math.hypot(q.x - hit.x, q.z - hit.z) < 2)) list.push({ x: hit.x, z: hit.z, a });
    }
  }
  const angles = new Map<string, number[]>();
  for (const [k, list] of out) angles.set(k, list.map((q) => q.a));
  return angles;
};

/** Why a mouth deck's path does not cross the river as built ("" = it does): edge e's built
 *  centerline exactly `crossings` times, no other river twice, and every crossing at ≥
 *  BRIDGE_MIN_CROSSING — never beside a pond's end or across a gap, never near parallel. */
export const builtCrossingRule = (pts: PointXZ[], e: RiverEdge, crossings: 0 | 1): string => {
  const rc = builtRiverCrossings(pts);
  const mine = rc.get(e.key)?.length ?? 0;
  if (mine !== crossings) return mine === 0 ? "misses the built river" : "crosses the river twice";
  for (const [k, list] of rc) {
    if (k !== e.key && list.length > 1) return "crosses another river twice";
    for (const a of list) if (a < BRIDGE_MIN_CROSSING) return `shallow crossing (${Math.round((a * 180) / Math.PI)}°)`;
  }
  return "";
};
