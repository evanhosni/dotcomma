/** Step 4: a chain's deck, built lazily — the rules, the T trims, clearance over the water, the arch
 *  and the piers — and the verdicts that decide which crossings of their own stand. */

import { seedRand } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { computeVertexDataRaw } from "../flattenPads";
import { warp } from "../noise";
import { riverFieldAt, riverSample } from "../rivers/riverField";
import { computeVertexData } from "../vertexCompute";
import { BRIDGE_CUT_BELOW_TOP, BRIDGE_DECK_LIFT, BRIDGE_EDGE_GUARD, BRIDGE_MAX_ALONG_SHORE, BRIDGE_MAX_LENGTH, BRIDGE_MAX_TURN, BRIDGE_MIN_CROSSING, BRIDGE_MIN_T_SIN, BRIDGE_TEE_OFF_HOST, BRIDGE_WET_SAMPLE, deckWidth } from "./constants";
import { boxApart, CROSSING_NEAR_PAD, CROSSING_OVERLAP_CLEAR, crossingBefore, crossingGeom, crossingGeoms, failedCrossing, FILL_CLEAR, FILL_SNAP_MAX, geomBoxApart, mouthBefore, mouthRank, resolveCrossingChain } from "./crossings";
import { bridgeArchShape, bridgeDeckY, pathDistance } from "./deckGeometry";
import { bridgeDebug, WINDOW_TOO_SMALL } from "./freewayBridges";
import { landedCut, landingOf, withLandedCutMode } from "./landings";
import { MOUTH_CLUSTER, MOUTH_TANGENT, mouthBranchGeom } from "./mouths";
import { hermitePoints, polyDirAt, polylinesApart, polyPointAt, projectOnPolyline } from "./polyline";
import { alongShoreLength, centerlineCrossings, sharpestTurn } from "./rules";
import type { BridgeChain, BridgeLanding, BridgePlacementParams, Crossing, CrossingGeom, FreewayBridge, Mouth, TeeTrim, WindowScan } from "./types";
import { extendOntoRoundedHost, teeHostChain } from "./wetItems";

/** Over the channel the deck clears the water by this. */
const BRIDGE_WATER_CLEARANCE = 4.5;
/** Over the water band past the channel (the bank held at the rim) the deck clears the water by this. */
const BRIDGE_BANK_CLEARANCE = 1;
/** The clearance raise may arch a plain deck up to this, or 10% of its length if more (a road
 *  descending to a river that rides higher ground); beyond, the deck is dropped, never drowned. */
const BRIDGE_MAX_CAMBER = 16;
const BRIDGE_MAX_CAMBER_PER_LENGTH = 0.1;
/** The step a T-child's landed end may be lifted by to clear the water: the character
 *  controller's autostep (physics/characterMovement.ts). A child needing more arches instead. */
const BRIDGE_MAX_END_LIFT = 0.5;
/** Beside a T end the arch cannot help (the host fixes the height): the deck top must stand this
 *  far over the water there — the 1.4u slab (bridgeSpec's BRIDGE_DECK_THICKNESS) kept dry. */
const BRIDGE_JUNCTION_MIN_CLEARANCE = 2;

/** How far a T-child's cut lies inside its host's slab: the two tops overlap there, so no crack. */
const BRIDGE_TEE_OVERLAP = 0.6;
/** A T-child meets its host at no shallower than this: two roads converging at a narrow angle would
 *  overlap as two decks with crossing parapets. */
const BRIDGE_MIN_T_ANGLE = (35 * Math.PI) / 180;

/** 4. The deck of a chain, built LAZILY and memoized on the chain (state 1 = building, so a T
 *  cycle drops). A dropped chain returns null and records why. Throws WINDOW_TOO_SMALL for a chain
 *  at the edge of a window that is not the `last`. */
export const deckBuilder = (scan: WindowScan, params: BridgePlacementParams, last: boolean, chains: BridgeChain[], synths: BridgeChain[]) => {
  const reach = scan.reach;
  const halfWidth = domainConfig!.river.halfWidth;
  const W = deckWidth();
  const minTSin = Math.sin(BRIDGE_MIN_T_ANGLE);
  const drop = (c: BridgeChain, why: string): null => {
    c.drop = why;
    c.deck = null;
    c.state = 2;
    bridgeDebug.dropped++;
    const kinds = c.synth ? `crossing:${c.synth.kind}` : c.parts.map((p) => p.item.kind + (p.item.open[0] ? "o" : "l") + (p.item.open[1] ? "o" : "l")).join("+");
    const ends = c.path.length > 1 ? ` ends ${Math.round(c.path[0].x)},${Math.round(c.path[0].z)}~${Math.round(c.path[c.path.length - 1].x)},${Math.round(c.path[c.path.length - 1].z)}` : "";
    bridgeDebug.drops.push(`${why} @${Math.round(c.midX)},${Math.round(c.midZ)} [${kinds} L=${Math.round(c.length)}]${ends}`);
    return null;
  };
  const build = (c: BridgeChain): FreewayBridge | null => {
    if (c.state === 2) return c.deck;
    if (c.state === 1) return drop(c, "T cycle");
    c.state = 1;
    // A natural branch knows its extent (and so whether it is at the window's edge) once resolved.
    if (c.synth && !resolveCrossingChain(c)) return drop(c, crossingGeom(c.synth).why);
    if (c.edge) {
      if (!last) throw WINDOW_TOO_SMALL;
      return drop(c, "window");
    }
    if (c.synth) {
      const why = crossingVerdict(c);
      if (why) return drop(c, why);
      const g = crossingGeom(c.synth);
      // A mouth branch tees into its trunk like any road's T-child.
      if (g.teeEnd !== undefined) return deckWithEnds(c);
      // Each end cut along the road's edge where it lies on pavement (landedCut), else landed on the
      // road's height at its end — a mouth pair's found only now (a padded terrain evaluation each,
      // a flatten tile when cold).
      const fix: { t: number; y: number }[] = [];
      const trims: (TeeTrim | null)[] = [];
      for (const which of [0, 1] as const) {
        const cut = landedCut(c.path, c.cum, which, g.width);
        if (cut && cut.trim + cut.sweep + (trims[0] ? trims[0].trim + trims[0].sweep : 0) < c.length - 4) {
          fix.push({ t: which === 0 ? cut.trim / c.length : 1 - cut.trim / c.length, y: cut.y });
          trims.push(cut);
          continue;
        }
        if (Number.isNaN(g.ys[which])) {
          const p = g.path[which === 0 ? 0 : g.path.length - 1];
          g.ys[which] = computeVertexData(p.x, p.z).height;
        }
        fix.push({ t: which, y: g.ys[which] });
        trims.push(null);
      }
      const deck = deckOf(c, fix, trims, g.width);
      if (deck && g.street) deck.laneScale = domainConfig!.cityConfig.freewayWidth / domainConfig!.cityConfig.roadWidth;
      return deck;
    }
    if (c.drop) return drop(c, c.drop);
    if (c.length < 1) return drop(c, "degenerate");
    if (c.length > BRIDGE_MAX_LENGTH) return drop(c, "too long");
    if (c.ends.some((e) => e.kind === "open")) return drop(c, "open end");
    const teeEnds = c.ends.filter((e) => e.kind === "tee").length;
    // A deck from one deck to another never touches land — a stub hanging between two decks over the
    // water. Its road ends at the quays instead.
    if (teeEnds === 2) return drop(c, "between two decks");
    // An inter-city RUN is the only road between two cities: wherever it is wet it keeps its deck
    // (it only yields near the water, runRiverYield — grazing a pond or a bank it stays a road). The
    // belt and the city's arterials have the quay, so the shore rules apply to them.
    const run = c.parts.every((p) => p.item.kind === "run");
    if (teeEnds === 0 && !run) {
      const cross = centerlineCrossings(scan, c.wx, c.wz);
      if (!cross.odd) return drop(c, "along the shore");
      if (cross.angle < BRIDGE_MIN_CROSSING) return drop(c, `shallow crossing (${Math.round((cross.angle * 180) / Math.PI)}°)`);
    }
    if (!run) {
      const along = alongShoreLength(scan, c);
      if (along > BRIDGE_MAX_ALONG_SHORE) return drop(c, `along the shore for ${Math.round(along)}u`);
    }
    const kink = sharpestTurn(c);
    if (kink > BRIDGE_MAX_TURN && !(teeEnds === 0 && smoothKink(c, run))) return drop(c, `kinked (${Math.round((kink * 180) / Math.PI)}°)`);
    return teeEnds === 0 ? withCutRetry(c, () => deckWithEnds(c)) : deckWithEnds(c);
  };
  /** A landed deck whose ends are cut where their edges leave the pavement for the LAST time can land
   *  far down a road climbing away from the river, and then no arch clears the water from there: rather
   *  than lose the crossing (a severed freeway), such a deck is built again with its ends cut where the
   *  edges FIRST leave the pavement — and failing that, uncut at the chain's ends. Only a road's own
   *  chain: a synthesized crossing that drops has the road's own deck or another crossing beside it
   *  (retried, a mouth deck leaving its road at a skew could ride far over the pavement it climbed
   *  from). */
  const withCutRetry = (c: BridgeChain, make: () => FreewayBridge | null): FreewayBridge | null => {
    let deck = make();
    for (const mode of [1, 2] as const) {
      if (deck || !/^(clearance|submerged)/.test(c.drop)) return deck;
      c.state = 1;
      c.drop = "";
      bridgeDebug.dropped--;
      bridgeDebug.drops.pop();
      deck = withLandedCutMode(mode, make);
    }
    return deck;
  };
  /** A deck landed at both ends whose road turns too sharply over the water (a belt corner at a wall
   *  junction in the channel, between walls too short to round) is carried on a CURVE instead: a cubic
   *  Hermite from its one landed end to the other, tangent to the road at both (as a mouth pair's),
   *  when that keeps every rule. Its identity (midpoint, ownership) stays the chain's. */
  const smoothKink = (c: BridgeChain, run: boolean): boolean => {
    const p = c.path;
    const n = p.length;
    if (n < 3) return false;
    const a = p[0];
    const b = p[n - 1];
    const al = Math.hypot(p[1].x - a.x, p[1].z - a.z) || 1;
    const bl = Math.hypot(b.x - p[n - 2].x, b.z - p[n - 2].z) || 1;
    const chord = Math.hypot(b.x - a.x, b.z - a.z);
    const pts = hermitePoints(a, { x: (p[1].x - a.x) / al, z: (p[1].z - a.z) / al }, b, { x: (b.x - p[n - 2].x) / bl, z: (b.z - p[n - 2].z) / bl }, chord * MOUTH_TANGENT);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const trial = { ...c, path: pts, cum, length: cum[cum.length - 1] };
    if (sharpestTurn(trial) > BRIDGE_MAX_TURN || trial.length > BRIDGE_MAX_LENGTH) return false;
    if (!run) {
      const wx: number[] = [];
      const wz: number[] = [];
      for (const q of pts) {
        const w = warp(q.x, q.z);
        wx.push(w.x);
        wz.push(w.z);
      }
      const cross = centerlineCrossings(scan, wx, wz);
      if (!cross.odd || cross.angle < BRIDGE_MIN_CROSSING) return false;
    }
    c.path = pts;
    c.cum = cum;
    c.length = trial.length;
    return true;
  };
  /** A chain's deck from its two ends: a landed end fixes the height on the road, a T end where its
   *  trimmed section meets its host's slab edge. */
  const deckWithEnds = (c: BridgeChain): FreewayBridge | null => {
    if (c.ends[0].kind !== "open" && c.ends[1].kind !== "open") {
      for (let which = 0; which < 2; which++) {
        const host = teeHostChain(c.ends[which]);
        const hostDeck = host ? build(host) : null;
        if (hostDeck) extendOntoRoundedHost(c, which as 0 | 1, hostDeck);
      }
    }
    const L = c.length;
    // Each end fixes the deck height at one arc position: a landed end on the road, a T end where
    // its trimmed section meets the host's slab edge.
    const fix: { t: number; y: number }[] = [];
    const trims: (TeeTrim | null)[] = [];
    for (let which = 0; which < 2; which++) {
      const end = c.ends[which];
      const p = which === 0 ? c.path[0] : c.path[c.path.length - 1];
      if (end.kind === "open") return drop(c, "open end");
      if (end.kind === "landed") {
        const cut = landedCut(c.path, c.cum, which as 0 | 1, W);
        if (cut && cut.trim + cut.sweep + (trims[0] ? trims[0].trim + trims[0].sweep : 0) < L - 4) {
          fix.push({ t: which === 0 ? cut.trim / L : 1 - cut.trim / L, y: cut.y });
          trims.push(cut);
          continue;
        }
        fix.push({ t: which, y: computeVertexData(p.x, p.z).height });
        trims.push(null);
        continue;
      }
      const host = build(teeHostChain(end)!);
      if (!host) return drop(c, "host dropped");
      const hostPath = host.path.map((q) => ({ x: q.x, z: q.z }));
      const hostCum = host.path.map((q) => q.t * host.length);
      const hp = projectOnPolyline(hostPath.map((q) => q.x), hostPath.map((q) => q.z), p.x, p.z);
      // A T end on a corner the host's deck rounds is no longer on the host.
      if (hp.d > BRIDGE_TEE_OFF_HOST) return drop(c, `off the host's rounded corner (${hp.d.toFixed(1)}u)`);
      // The trim: where the child's centerline leaves the host's slab — its distance from the host's
      // centerline reaching W/2, found along the child (W/2 / sin θ assumes a straight host and an end
      // exactly on its centerline: a gap between the cut and a curving host's edge).
      const hx = hostPath.map((v) => v.x);
      const hz = hostPath.map((v) => v.z);
      const endS = which === 0 ? 0 : L;
      const inward = which === 0 ? 1 : -1;
      const offHost = (off: number) => {
        const v = polyPointAt(c.path, c.cum, endS + inward * off);
        return projectOnPolyline(hx, hz, v.x, v.z).d;
      };
      let out = 0;
      while (out < L && offHost(out) < W / 2) out += 1;
      if (out >= L - 4) return drop(c, "short T");
      let inside = Math.max(0, out - 1);
      for (let it = 0; it < 20; it++) {
        const mid = (inside + out) / 2;
        if (offHost(mid) < W / 2) inside = mid;
        else out = mid;
      }
      // The straight cut along the host's direction there must lie INSIDE the host's slab at every
      // point — its center and both corners — by BRIDGE_TEE_OVERLAP: against a curving host the
      // tangent cut stands off the host's edge, and the sand shows through a crack.
      let trim = out;
      let sEdge = 0;
      let q: PointXZ = c.path[0];
      let qp = { s: 0, d: 0 };
      let hDir: PointXZ = { x: 1, z: 0 };
      let cDir: PointXZ = { x: 1, z: 0 };
      let sin = 1;
      for (let pass = 0; pass < 4; pass++) {
        sEdge = endS + inward * trim;
        q = polyPointAt(c.path, c.cum, sEdge);
        qp = projectOnPolyline(hx, hz, q.x, q.z);
        hDir = polyDirAt(hostPath, hostCum, qp.s);
        // The child's travel direction there (path order).
        cDir = polyDirAt(c.path, c.cum, sEdge);
        sin = Math.abs(cDir.x * hDir.z - cDir.z * hDir.x);
        if (sin < minTSin) return drop(c, "shallow T");
        const hnPass = hDir.x * -cDir.z + hDir.z * cDir.x;
        const k = 1 / (Math.sign(hnPass || 1) * Math.max(Math.abs(hnPass), BRIDGE_MIN_T_SIN));
        let excess = 0;
        for (const lat of [0, W / 2, -W / 2]) {
          const d = projectOnPolyline(hx, hz, q.x + hDir.x * k * lat, q.z + hDir.z * k * lat).d;
          excess = Math.max(excess, d - (W / 2 - BRIDGE_TEE_OVERLAP));
        }
        if (excess <= 1e-3) break;
        trim = Math.max(0, trim - excess / Math.max(sin, BRIDGE_MIN_T_SIN));
      }
      const sweep = (W / 2) * (Math.abs(cDir.x * hDir.x + cDir.z * hDir.z) / Math.max(sin, BRIDGE_MIN_T_SIN));
      // The trimmed deck, its oblique cut included, must keep a few units beyond its host's edge.
      if (trim + sweep + (trims[0] ? trims[0].trim + trims[0].sweep : 0) > L - 4) return drop(c, "short T");
      const hostSlope = (bridgeDeckY(host, Math.min(1, (qp.s + 1) / host.length)) - bridgeDeckY(host, Math.max(0, (qp.s - 1) / host.length))) / 2;
      const hn = hDir.x * -cDir.z + hDir.z * cDir.x; // hostDir · childLeft
      const hnc = Math.sign(hn || 1) * Math.max(Math.abs(hn), BRIDGE_MIN_T_SIN);
      fix.push({ t: sEdge / L, y: bridgeDeckY(host, qp.s / host.length) });
      trims.push({ trim, sweep, axis: { x: hDir.x / hnc, z: hDir.z / hnc, slope: hostSlope / hnc }, host });
    }
    return deckOf(c, fix, trims, W);
  };
  /** A synth chain's geometry, a natural branch's resolved first (its host is found in the window). */
  const geomOf = (o: BridgeChain): CrossingGeom => (resolveCrossingChain(o) ? crossingGeom(o.synth!) : failedCrossing("unresolved"));
  /** Whether a mouth crossing may come within `r` of a geometry — by its conservative bounds, so a
   *  natural branch far away is never resolved. */
  const mouthNear = (s: Crossing, g: CrossingGeom, r: number): boolean => (s.geom ? geomBoxApart(s.geom, g) : boxApart(s.box!, g)) <= r;
  /** Why a crossing of its own is not built beside the decks around it ("" = it is): a deck already
   *  crosses there, or a better crossing does (section 6). Every input is a pure function of the
   *  crossings and chains within reach, so every window that sees it decides it the same way. */
  const crossingVerdict = (c: BridgeChain): string => {
    const me = c.synth!;
    if (me.kind === "mouth") return mouthVerdict(c);
    const g = crossingGeom(me);
    const clear = me.kind === "fill" ? FILL_CLEAR : CROSSING_SPACING;
    const apart = (o: { path: PointXZ[] }) => polylinesApart(o.path, g.path);
    for (const o of chains) {
      if (o.synth || o.maxX < c.minX - clear || o.minX > c.maxX + clear || o.maxZ < c.minZ - clear || o.minZ > c.maxZ + clear) continue;
      const d = build(o);
      if (!d) continue;
      if (pathDistance(d, g.x, g.z) < clear) return "a deck crosses beside it";
      if (apart(d) < (d.width + g.width) / 2 + CROSSING_OVERLAP_CLEAR) return "overlaps a deck";
    }
    for (const o of synths) {
      const s = o.synth!;
      if (o === c) continue;
      // A mouth's deck may be long (MOUTH_PAIR_MAX): tested by its own extent, not its reference point.
      if (s.kind === "mouth" ? !mouthNear(s, g, clear + W) : Math.hypot(s.x - me.x, s.z - me.z) > clear + 2 * FILL_SNAP_MAX + CROSSING_NEAR_PAD) continue;
      const og = s.kind === "mouth" ? geomOf(o) : crossingGeom(s);
      if (!og.ok) continue;
      if (Math.hypot(og.x - g.x, og.z - g.z) >= clear && apart(og) >= (og.width + g.width) / 2 + CROSSING_OVERLAP_CLEAR) continue;
      // A freeway mouth's deck comes first (only its own test against the natural decks: a fuller
      // verdict would read beyond this window's guarantee).
      if (s.kind === "mouth") {
        if (mouthPre(o) === "") return "beside a mouth crossing";
        continue;
      }
      if (me.kind === "fill" && s.kind === "arterial") return "beside an arterial's crossing";
      if (me.kind === s.kind && crossingBefore(s, me)) return "beside a better crossing";
    }
    return "";
  };
  /** A natural branch (section 6b): the first mouth it faces whose road's OWN deck lands at it hosts
   *  it — a T into that deck, the geometry cached per host. False when none does. */
  const resolveNatural = (c: BridgeChain): boolean => {
    const me = c.synth!;
    if (me.geom) return me.geom.ok;
    const U = me.mouths![0];
    let why = "no deck across";
    if (naturalLandingNear(U)) {
      me.geom = failedCrossing("served at a junction");
      return false;
    }
    for (const V of me.faces!) {
      let host: BridgeChain | null = null;
      let hostDeck: FreewayBridge | null = null;
      let best = MOUTH_NATURAL_LAND;
      for (const o of chains) {
        if (o.synth || o.maxX < V.x - W || o.minX > V.x + W || o.maxZ < V.z - W || o.minZ > V.z + W) continue;
        const d = build(o);
        if (!d) continue;
        for (const which of [0, 1] as const) {
          const p = d.path[which === 0 ? 0 : d.path.length - 1];
          const dist = Math.hypot(p.x - V.x, p.z - V.z);
          if (o.ends[which].kind === "landed" && dist < best) {
            best = dist;
            host = o;
            hostDeck = d;
          }
        }
      }
      if (!host || !hostDeck) continue;
      const key = `${me.key}>${hostDeck.x.toFixed(3)},${hostDeck.z.toFixed(3)}`;
      let g = crossingGeoms.get(key);
      if (!g) {
        if (crossingGeoms.size > 8192) dropOldestHalf(crossingGeoms);
        g = mouthBranchGeom(U, V, { ...failedCrossing(""), ok: true, path: hostDeck.path.map((q) => ({ x: q.x, z: q.z })), width: hostDeck.width });
        crossingGeoms.set(key, g);
      }
      if (!g.ok) {
        why = g.why;
        continue;
      }
      me.geom = g;
      const j = g.path[g.teeEnd === 0 ? 0 : g.path.length - 1];
      c.ends[g.teeEnd!] = { kind: "tee", host: null, hostChain: host, hx: j.x, hz: j.z };
      c.resolver = undefined;
      const m = W + CROSSING_OVERLAP_CLEAR + BRIDGE_EDGE_GUARD;
      const { win } = scan;
      c.edge = g.path.some((p) => {
        const w = warp(p.x, p.z);
        return w.x - win.x0 < m || win.x1 - w.x < m || w.z - win.z0 < m || win.z1 - w.z < m;
      });
      return true;
    }
    me.geom = failedCrossing(why);
    return false;
  };
  for (const s of synths) if (s.synth!.faces) s.resolver = () => resolveNatural(s);
  /** Whether a road's own deck lands at a mouth's road junction (within MOUTH_CLUSTER): it serves it. */
  const naturalLandingNear = (m: Mouth): boolean => {
    const r = MOUTH_CLUSTER;
    for (const o of chains) {
      if (o.synth || o.maxX < m.x - r || o.minX > m.x + r || o.maxZ < m.z - r || o.minZ > m.z + r) continue;
      const d = build(o);
      if (!d) continue;
      for (const which of [0, 1] as const) {
        const p = d.path[which === 0 ? 0 : d.path.length - 1];
        if (o.ends[which].kind === "landed" && Math.hypot(p.x - m.x, p.z - m.z) < r) return true;
      }
    }
    return false;
  };
  /** A mouth crossing on its own (section 6b): its geometry, a branch's trunk passing too, and no
   *  natural deck — a road's own, other than a natural branch's host — overlapping it, which is also
   *  every case of a natural deck serving its mouths. Memoized. Reads the chains along its whole
   *  extent, so it is decided only in a window that holds all of it. */
  const mouthPre = (c: BridgeChain): string => {
    if (c.pre !== undefined) return c.pre;
    let why = "";
    if (!resolveCrossingChain(c)) why = crossingGeom(c.synth!).why;
    else if (c.edge) {
      if (!last) throw WINDOW_TOO_SMALL;
      why = "window";
    } else {
      const host = c.ends.map(teeHostChain).find(Boolean) ?? null;
      if (host?.synth) {
        const t = mouthPre(host);
        if (t) why = `trunk: ${t}`;
      }
      if (!why && mouthRank(c.synth!) === 1 && naturalLandingNear(c.synth!.mouths![0])) why = "served at a junction";
      const g = crossingGeom(c.synth!);
      const r = W + CROSSING_OVERLAP_CLEAR;
      for (const o of chains) {
        if (why) break;
        if (o.synth || o === host || o.maxX < c.minX - r || o.minX > c.maxX + r || o.maxZ < c.minZ - r || o.minZ > c.maxZ + r) continue;
        const d = build(o);
        if (d && polylinesApart(d.path, g.path) < (d.width + g.width) / 2 + CROSSING_OVERLAP_CLEAR) why = "overlaps a deck";
      }
    }
    c.pre = why;
    return why;
  };
  /** A mouth crossing beside the others: a deck of a mouth gives way to a better deck of the same
   *  mouth (a pair's, then a branch's, then a natural branch's, then a lone mouth's) that stands, and of
   *  two mouth decks overlapping, the better (then the shorter) is built; a branch and its trunk are
   *  one deck. One round: only mouthPre decides who is still in the running, so every window agrees. */
  const mouthVerdict = (c: BridgeChain): string => {
    const pre = mouthPre(c);
    if (pre) return pre;
    const me = c.synth!;
    const g = crossingGeom(me);
    for (const o of synths) {
      const s = o.synth!;
      if (o === c || s.kind !== "mouth" || s.key === me.trunk || s.trunk === me.key) continue;
      const mine = mouthRank(s) > mouthRank(me) && (s.covers ?? s.mouths!).includes(me.mouths![0]);
      if (!mine && !mouthNear(s, g, (W + g.width) / 2 + CROSSING_OVERLAP_CLEAR)) continue;
      const og = geomOf(o);
      if (!og.ok) continue;
      if (mine) {
        if (mouthPre(o) === "") return "its pair crosses";
        continue;
      }
      if (geomBoxApart(og, g) > (og.width + g.width) / 2 + CROSSING_OVERLAP_CLEAR || !mouthBefore(s, me)) continue;
      if (polylinesApart(og.path, g.path) >= (og.width + g.width) / 2 + CROSSING_OVERLAP_CLEAR) continue;
      if (mouthPre(o) === "") return "beside a better mouth crossing";
    }
    return "";
  };
  /** The deck of a chain whose ends are fixed (height at an arc fraction each) and whose T ends are
   *  trimmed: clearance over the water, the arch, the piers. */
  const deckOf = (c: BridgeChain, fix: { t: number; y: number }[], trims: (TeeTrim | null)[], W: number): FreewayBridge | null => {
    const L = c.length;
    for (let which = 0; which < 2; which++) if (!trims[which] && c.ends[which].kind === "landed") fix[which].y += BRIDGE_DECK_LIFT;
    let m = (fix[1].y - fix[0].y) / Math.max(1e-9, fix[1].t - fix[0].t);
    let sy = fix[0].y - m * fix[0].t;
    // Clearance over the water it crosses: a deck landed at both ends (a host too — its children
    // take their heights from it) is raised by an arch. One with a T end lifts its landed end into a
    // step the player walks up (a fixed 0.5u floor leaves its 1.4u slab in the water); where that
    // step would be too tall, it arches between its two fixed ends instead (bridgeDeckY: the arch
    // spans the drawn range, so it is 0 where the child meets its host).
    const landed = c.ends.every((e) => e.kind === "landed");
    const landedEnd = landed ? -1 : c.ends[0].kind === "landed" ? 0 : c.ends[1].kind === "landed" ? 1 : -1;
    let lift = 0;
    let submerged = false;
    const plain = landed && !c.merged && c.children.length === 0;
    let camber = 0;
    if (plain && seedRand(`${domainConfig!.seed} - bridge arch ${Math.round(c.midX)},${Math.round(c.midZ)}`) < params.archChance) {
      camber = Math.min(params.maxCamber, 0.06 * L);
    }
    // The arch's span (bridgeDeckY computes it the same way): [0, 1] unless a T end trims it.
    const archFrom = (trims[0]?.trim ?? 0) / L;
    const archTo = 1 - (trims[1]?.trim ?? 0) / L;
    const channel: { t: number; surface: number; center: number; clear: number }[] = [];
    const samples = Math.max(1, Math.ceil(L / BRIDGE_WET_SAMPLE));
    const waterBand = halfWidth + domainConfig!.river.bank * 0.5;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      // Along the DECK (its corners are rounded off the road), and only where water is drawn: the
      // channel, and the band past it where the bank is held at the rim (a deck along a river
      // climbing a slope would otherwise stand at the level of its water there). Over a dry bank
      // there is nothing to clear.
      // Across the deck's whole width: beside a river whose surface climbs along it, the water under
      // one edge can stand above the slab.
      const q = polyPointAt(c.path, c.cum, t * L);
      const d = polyDirAt(c.path, c.cum, t * L);
      // The edges clear the water by the bank's clearance at least (the centerline by the channel's).
      let surface = -Infinity;
      let center = NaN;
      let inChannel = false;
      for (const off of [0, W / 2, -W / 2]) {
        const w = warp(q.x - d.z * off, q.z + d.x * off);
        riverFieldAt(w.x, w.z);
        if (!(riverSample.distance < waterBand)) continue;
        if (off === 0) {
          center = riverSample.surface;
          inChannel = riverSample.distance < halfWidth;
        } else surface = Math.max(surface, riverSample.surface + BRIDGE_BANK_CLEARANCE);
      }
      const clear = inChannel ? BRIDGE_WATER_CLEARANCE : BRIDGE_BANK_CLEARANCE;
      const needed = Math.max(Number.isNaN(center) ? -Infinity : center + clear, surface);
      if (needed === -Infinity) continue;
      channel.push({ t, surface: needed - clear, center, clear });
      if (Number.isNaN(center)) continue;
      if (!inChannel) continue;
      const lin = sy + m * t;
      if (landed) continue;
      if (lin - center < BRIDGE_WATER_CLEARANCE) {
        submerged = true;
        if (landedEnd < 0) continue;
        // Lifting the landed end by δ lifts this sample by δ × its share of the way from the T fix.
        const tFix = fix[1 - landedEnd].t;
        const share = Math.abs(t - tFix) / Math.max(1e-9, Math.abs(landedEnd - tFix));
        lift = Math.max(lift, share > 1e-3 ? (BRIDGE_WATER_CLEARANCE - (lin - center)) / share : Infinity);
      }
    }
    const archSpan = archTo - archFrom;
    if (landed || (submerged && (landedEnd < 0 || lift > BRIDGE_MAX_END_LIFT))) {
      lift = 0;
      for (const { t, surface, center, clear } of channel) {
        const u = (t - archFrom) / archSpan;
        const shape = bridgeArchShape(u);
        const need = surface + clear - (sy + m * t);
        if (need <= 0) continue;
        if (shape > 0.2) camber = Math.max(camber, need / shape);
        // Near an end no arch lifts the deck (a landed deck ignores these samples too); beside a
        // T end the host fixes the height, so there the slab must at least stay out of the water —
        // judged on its centerline only (the edge samples only raise the arch).
        // Under the host's slab (u outside [0, 1]) the child is trimmed off anyway.
        else if (u > 0 && u < 1 && trims[u < 0.5 ? 0 : 1] && !Number.isNaN(center)) {
          const needC = center + clear - (sy + m * t);
          if (clear - needC < (clear === BRIDGE_WATER_CLEARANCE ? BRIDGE_JUNCTION_MIN_CLEARANCE : 0)) return drop(c, `submerged at the junction (${(clear - needC).toFixed(1)}u over the water)`);
        }
      }
    }
    if (camber > Math.max(BRIDGE_MAX_CAMBER, BRIDGE_MAX_CAMBER_PER_LENGTH * archSpan * L)) return drop(c, `clearance (arch ${camber.toFixed(1)}u; ends ${fix[0].y.toFixed(1)}/${fix[1].y.toFixed(1)}, water ${Math.max(...channel.map((q) => q.surface)).toFixed(1)})`);
    if (lift > 0) {
      fix[landedEnd].y += lift;
      m = (fix[1].y - fix[0].y) / Math.max(1e-9, fix[1].t - fix[0].t);
      sy = fix[0].y - m * fix[0].t;
    }
    const ey = sy + m;

    const deck: FreewayBridge = {
      x: c.midX,
      z: c.midZ,
      sx: c.path[0].x,
      sy,
      sz: c.path[0].z,
      ex: c.path[c.path.length - 1].x,
      ey,
      ez: c.path[c.path.length - 1].z,
      path: c.path.map((p, i) => ({ x: p.x, z: p.z, t: c.cum[i] / L })),
      length: L,
      width: W,
      camber,
      piers: [],
      paint: { a0: 0, r0: 1, a1: 0, r1: 1, has0: false, has1: false, off: [] },
    };
    const [t0, t1] = trims;
    if (t0) {
      deck.trimStart = t0.trim;
      deck.trimStartAxis = t0.axis;
    }
    if (t1) {
      deck.trimEnd = t1.trim;
      deck.trimEndAxis = t1.axis;
    }
    // Piers over the footprint, on the deck's own arc lattice.
    const sFrom = deck.trimStart ?? 0;
    const sTo = L - (deck.trimEnd ?? 0);
    for (let s = params.pierSpacing / 2; s < L; s += params.pierSpacing) {
      if (s < sFrom + 2 || s > sTo - 2) continue;
      const p = polyPointAt(c.path, c.cum, s);
      const w = warp(p.x, p.z);
      riverFieldAt(w.x, w.z);
      if (!(riverSample.distance < reach)) continue;
      const dir = polyDirAt(c.path, c.cum, s);
      // The raw ground less the cut under this very deck (the terrain's, computeVertexData).
      const groundY = Math.min(computeVertexDataRaw(p.x, p.z).height, bridgeDeckY(deck, s / L) - BRIDGE_CUT_BELOW_TOP);
      deck.piers.push({ x: p.x, z: p.z, groundY, t: s / L, dirX: dir.x, dirZ: dir.z });
    }
    // A landed end cut along the road's edge needs no ramp: it starts at the road's own height.
    deck.landings = [0, 1].map((which) => {
      const trim = trims[which];
      if (trim) return trim.host === null ? { drop: 0, slope: 0, ramp: 0 } : null;
      return c.ends[which].kind === "landed" ? landingOf(deck, which as 0 | 1) : null;
    }) as [BridgeLanding | null, BridgeLanding | null];
    bridgeDebug.joins += trims.filter(Boolean).length;
    c.deck = deck;
    c.state = 2;
    return deck;
  };
  return build;
};

/** A deck within this of an arterial's crossing already carries it; of two arterial crossings this
 *  close, the squarer one is built. */
const CROSSING_SPACING = 120;

/** A lone mouth whose road is at most this far off square to the river gets a straight deck
 *  (turned to CROSSING_MAX_SKEW), landing on its own bank within MOUTH_SINGLE_LAND of the mouth. */
/** A natural branch's host is the deck landing within this of the mouth it faces. */
const MOUTH_NATURAL_LAND = 30;
