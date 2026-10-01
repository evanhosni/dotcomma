/** The round-18 rules (CHANGES.md §2.24), on the real compute module with the overworld's shared config:
 *  between a landed cut end and the road it lands on the terrain paints ASPHALT, flush against the deck
 *  — no curb, sidewalk or sand between them — and the mouth changes the road's paint nowhere else; a
 *  deck's lane dashes keep the road's own period; its profile has no kinks and the road into it no bumps. */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { BRIDGE_PLACEMENT } from "../../../objects/dressing/bridges/bridgeSpec";
import { bridgeDrawn, bridgeDrawnAt, bridgeMouthFieldAt } from "./drawnSlab";
import { type FreewayBridge, bridgeLaneAlong, bridgePaintAt, bridgeSections, computeVertexData, computeVertexDataRaw, getFreewayBridges, initCompute, setDeckCutSpacing } from "../vertexCompute";

const CHUNK = 256;
const LOD1 = 420 / 96;
/** Under this road field the terrain paints asphalt (city_frag's curb color is half in at R + 0.1). */
const ASPHALT = 7.1;

const decksNear = (cx: number, cz: number, r: number): FreewayBridge[] => {
  const out: FreewayBridge[] = [];
  for (let gx = Math.floor(cx / CHUNK) - r; gx <= Math.floor(cx / CHUNK) + r; gx++) {
    for (let gz = Math.floor(cz / CHUNK) - r; gz <= Math.floor(cz / CHUNK) + r; gz++) {
      out.push(...getFreewayBridges(gx * CHUNK, gz * CHUNK, (gx + 1) * CHUNK, (gz + 1) * CHUNK, BRIDGE_PLACEMENT));
    }
  }
  return out;
};

/** The road field as the LOD1 mesh draws it: vertex values on the terrain's triangles. */
const vertexField = new Map<string, number>();
const meshField = (x: number, z: number): number => {
  const at = (vx: number, vz: number) => {
    const key = `${vx},${vz}`;
    let f = vertexField.get(key);
    if (f === undefined) {
      setDeckCutSpacing(LOD1);
      f = computeVertexData(vx, vz).distanceToRoadCenter;
      vertexField.set(key, f);
    }
    return f;
  };
  const ix = Math.floor(x / LOD1);
  const iz = Math.floor(z / LOD1);
  const u = x / LOD1 - ix;
  const v = z / LOD1 - iz;
  const x0 = Math.fround(ix * LOD1);
  const x1 = Math.fround((ix + 1) * LOD1);
  const a = at(x0, iz * LOD1);
  const b = at(x1, iz * LOD1);
  const c = at(x1, (iz + 1) * LOD1);
  const d = at(x0, (iz + 1) * LOD1);
  return u + v <= 1 ? a + (b - a) * u + (d - a) * v : c + (d - c) * (1 - u) + (b - c) * (1 - v);
};

/** The terrain height as the LOD1 mesh draws it. */
const vertexHeight = new Map<string, number>();
const meshHeight = (x: number, z: number): number => {
  const at = (vx: number, vz: number) => {
    const key = `${vx},${vz}`;
    let h = vertexHeight.get(key);
    if (h === undefined) {
      setDeckCutSpacing(LOD1);
      h = computeVertexData(vx, vz).height;
      vertexHeight.set(key, h);
    }
    return h;
  };
  const ix = Math.floor(x / LOD1);
  const iz = Math.floor(z / LOD1);
  const u = x / LOD1 - ix;
  const v = z / LOD1 - iz;
  const x0 = Math.fround(ix * LOD1);
  const x1 = Math.fround((ix + 1) * LOD1);
  const a = at(x0, iz * LOD1);
  const b = at(x1, iz * LOD1);
  const c = at(x1, (iz + 1) * LOD1);
  const d = at(x0, (iz + 1) * LOD1);
  return u + v <= 1 ? a + (b - a) * u + (d - a) * v : c + (d - c) * (1 - u) + (b - c) * (1 - v);
};

const onSlab = (decks: FreewayBridge[], x: number, z: number): boolean =>
  decks.some((d) => {
    bridgeDrawnAt(d, x, z, 0);
    return bridgeDrawn.weight >= 1 && Number.isNaN(bridgeDrawn.flush) && Number.isFinite(bridgeDrawn.own);
  });

/** Every landed CUT end: its end section's frame — the travel direction into the deck, and the point
 *  on the cut line at lateral offset l, `depth` in front of it. */
const cutEnds = (decks: FreewayBridge[]) =>
  decks.flatMap((b) => {
    const S = bridgeSections(b);
    return ([0, 1] as const).flatMap((which) => {
      const axis = which === 0 ? b.trimStartAxis : b.trimEndAxis;
      if (!axis || !b.landings?.[which] || b.landings[which]!.ramp > 0) return [];
      const e = which === 0 ? S[0] : S[S.length - 1];
      const q = which === 0 ? S[1] : S[S.length - 2];
      const dl = Math.hypot(q.x - e.x, q.z - e.z) || 1;
      const dx = (q.x - e.x) / dl;
      const dz = (q.z - e.z) / dl;
      const lean = (e.ax * dx + e.az * dz) / (e.ax * -dz + e.az * dx);
      const at = (l: number, depth: number) => ({ x: e.x - dz * l + dx * (lean * l - depth), z: e.z + dx * l + dz * (lean * l - depth) });
      const frame = (x: number, z: number) => {
        const l = (x - e.x) * -dz + (z - e.z) * dx;
        return { l, depth: lean * l - ((x - e.x) * dx + (z - e.z) * dz) };
      };
      return [{ b, half: b.width / 2, at, frame }];
    });
  });

describe("round-18 deck mouth, lane and profile rules", () => {
  let decks: FreewayBridge[] = [];
  beforeAll(() => {
    initCompute(OVERWORLD_CONFIG);
    decks = [
      // A city deck landing across a quay road (the curb strip across its mouth, 63's kind)…
      ...decksNear(-6800, -15, 1),
      // …an oblique city landing (a knob and a stepped corner beside the mouth, 66's kind)…
      ...decksNear(-11280, -22690, 1),
      // …an inter-city run carried straight on by a deck wider than the road…
      ...decksNear(5620, 1420, 1),
      // …a deck landing on two different roads (67: a dash every few decimetres)…
      ...decksNear(-4558, 792, 1),
      // …and a steep hillside crossing (73–76: a lopsided, kinked slab; a wall of road at a landing).
      ...decksNear(-187, 3192, 1),
    ];
  });

  it("paints asphalt between every landed cut end and its road's asphalt", () => {
    const ends = cutEnds(decks);
    expect(ends.length).toBeGreaterThan(6);
    let samples = 0;
    let bad = 0;
    for (const E of ends) {
      for (let l = -E.half + 0.25; l <= E.half - 0.25; l += 0.5) {
        // Only where the road's asphalt lies ahead along the deck: a column running beside the road (a
        // deck wider than the road it continues) keeps the road's own curb.
        let top = -1;
        for (let d = 0; d <= 12 && top < 0; d += 0.25) {
          const p = E.at(l, d);
          if (computeVertexDataRaw(p.x, p.z).distanceToRoadCenter < 6.7) top = d;
        }
        for (let d = 0.1; d < top; d += 0.4) {
          const p = E.at(l, d);
          if (onSlab(decks, p.x, p.z)) continue;
          samples++;
          if (meshField(p.x, p.z) >= ASPHALT) bad++;
        }
      }
    }
    expect(samples).toBeGreaterThan(1000);
    // (What is left is the curb line's own interpolation at a deck's corner.)
    expect(bad / samples).toBeLessThan(0.01);
  });

  it("changes the road's paint nowhere but at a deck's mouth", () => {
    const raw = (x: number, z: number) => computeVertexDataRaw(x, z).distanceToRoadCenter;
    const inward = LOD1 * Math.SQRT2 + 0.5;
    const ends = cutEnds(decks);
    let painted = 0;
    let away = 0;
    for (const b of decks) {
      for (const which of [0, 1] as const) {
        const p = b.path[which === 0 ? 0 : b.path.length - 1];
        for (let x = p.x - 40; x <= p.x + 40; x += 1.5) {
          for (let z = p.z - 40; z <= p.z + 40; z += 1.5) {
            const f = bridgeMouthFieldAt(b, x, z, inward, 4.5, raw);
            if (!(f < raw(x, z))) continue;
            painted++;
            const atMouth = ends.some((E) => {
              if (E.b !== b) return false;
              const { l, depth } = E.frame(x, z);
              return Math.abs(l) <= E.half + 5 && depth >= -inward - 4 && depth <= 16;
            });
            if (!atMouth) away++;
          }
        }
      }
    }
    expect(painted).toBeGreaterThan(100);
    expect(away).toBe(0);
  });

  it("keeps the road's lane-dash period on every deck", () => {
    let painted = 0;
    let worst = 0;
    for (const b of decks) {
      const p = b.paint;
      if (!(p.has0 || p.has1) || p.off.some(([t0, t1]) => t0 <= 0 && t1 >= 1)) continue;
      painted++;
      const d0 = -p.r0;
      const d1 = p.r0 * p.r1 > 0 ? -p.r1 : p.r1;
      const n = Math.max(8, Math.ceil(b.length));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        if (!bridgePaintAt(b, t)) continue;
        const rate = Math.abs(bridgeLaneAlong(b, (i + 1) / n) - bridgeLaneAlong(b, i / n)) / (b.length / n);
        const road = p.has0 && p.has1 ? Math.abs(d0 + (d1 - d0) * t) : Math.abs(p.has0 ? p.r0 : p.r1);
        worst = Math.max(worst, Math.abs(rate / road - 1));
      }
    }
    expect(painted).toBeGreaterThan(2);
    expect(worst).toBeLessThan(0.05);
  });

  it("keeps every deck's profile smooth and the road into its landed ends without bumps", () => {
    // Along the centerline and both edges, the pitch changes by at most this between two chords…
    let kink = 0;
    for (const b of decks) {
      const S = bridgeSections(b);
      for (const lat of [0, 0.9, -0.9]) {
        const pts = S.map((q) => {
          const w = lat * (lat > 0 ? q.wl : q.wr);
          return { x: q.x + q.ax * w, z: q.z + q.az * w, y: q.y + q.slope * w };
        });
        for (let i = 1; i + 1 < pts.length; i++) {
          const h0 = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
          const h1 = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
          if (h0 < 0.5 || h1 < 0.5) continue;
          kink = Math.max(kink, Math.abs((pts[i + 1].y - pts[i].y) / h1 - (pts[i].y - pts[i - 1].y) / h0));
        }
      }
    }
    expect(kink).toBeLessThan(0.16);
    // …and the road in front of every landed cut end, as the LOD1 mesh draws it, bends by at most this.
    let bump = 0;
    for (const E of cutEnds(decks)) {
      for (const l of [-8, 0, 8]) {
        const hs: number[] = [];
        for (let d = 0; d <= 40; d += 2) {
          const p = E.at(l, d);
          hs.push(meshHeight(p.x, p.z));
        }
        for (let k = 1; k + 1 < hs.length; k++) bump = Math.max(bump, Math.abs(hs[k + 1] - 2 * hs[k] + hs[k - 1]) / 4);
      }
    }
    expect(bump).toBeLessThan(0.3);
  });
});
