import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import {
  BRIDGE_PARAPET_WIDTH,
  bridgeDrawnTopAt,
  bridgeParapetAt,
  bridgeSections,
  computeVertexData,
  getFreewayBridges,
  initCompute,
} from "../../../utils/workers/vertexCompute";
import { BRIDGE_DECK_THICKNESS, BRIDGE_PARAPET_HEIGHT, BRIDGE_PIER_SIZE, BRIDGE_PLACEMENT, bridgeColliderPoints, bridgePierColumns, bridgeRibbon, type BridgeColliderPoint } from "./bridgeSpec";

// Bridge colliders against the drawn deck: one body per chord whose mesh IS what the ribbon draws there
// — the slab's top, underside and edges, and each standing wall — so a player stands exactly on the
// drawn top (a pitched box per chord sits up to 6.7u off a twisting slab) and meets a wall exactly
// where one is drawn (a box running past a wall's visible end is an invisible wall in the roadway).
// Client and server both mount bridgeColliderPoints.

initCompute(OVERWORLD_CONFIG);

/** The highest mesh triangle over (x, z) of a chord body (its mesh is unrotated, relative to the body). */
const meshTopAt = (p: BridgeColliderPoint, x: number, z: number, skipAbove = Infinity): number => {
  const v = p.mesh.vertices;
  const ix = p.mesh.indices;
  let best = -Infinity;
  for (let k = 0; k < ix.length; k += 3) {
    const [a, b, c] = [ix[k] * 3, ix[k + 1] * 3, ix[k + 2] * 3];
    const ax = v[a] + p.x, az = v[a + 2] + p.z, bx = v[b] + p.x, bz = v[b + 2] + p.z, cx = v[c] + p.x, cz = v[c + 2] + p.z;
    const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (Math.abs(det) < 1e-9) continue;
    const l1 = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) / det;
    const l2 = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) / det;
    if (l1 < -1e-6 || l2 < -1e-6 || l1 + l2 > 1 + 1e-6) continue;
    const y = p.y + v[a + 1] + (v[b + 1] - v[a + 1]) * l1 + (v[c + 1] - v[a + 1]) * l2;
    if (y < skipAbove) best = Math.max(best, y);
  }
  return best;
};

/** Decks around a river crossing between two city lobes, with T-junctions and parapet gaps. */
const decksNear = (cx: number, cz: number, r: number) => {
  const CHUNK = 256;
  const out = [];
  for (let gx = Math.floor(cx / CHUNK) - r; gx <= Math.floor(cx / CHUNK) + r; gx++) {
    for (let gz = Math.floor(cz / CHUNK) - r; gz <= Math.floor(cz / CHUNK) + r; gz++) {
      out.push(...getFreewayBridges(gx * CHUNK, gz * CHUNK, (gx + 1) * CHUNK, (gz + 1) * CHUNK, BRIDGE_PLACEMENT));
    }
  }
  return out;
};

describe("bridge colliders", () => {
  // + a city river whose crossings are decks of their own (street decks landing on the quays).
  const decks = [...decksNear(-15835, 10076, 2), ...decksNear(3785, 10901, 1), ...decksNear(-7670, -14313, 1), ...decksNear(-4289, 661, 2)];

  it("finds decks with junctions to check", () => {
    expect(decks.length).toBeGreaterThan(3);
    expect(decks.some((b) => b.trimStart !== undefined || b.trimEnd !== undefined)).toBe(true);
    expect(decks.some((b) => (b.gaps ?? []).length > 0)).toBe(true);
  });

  it("gives every chord one body whose walls stand exactly where the ribbon draws standing walls", () => {
    let checked = 0;
    for (const b of decks) {
      const sections = bridgeSections(b);
      const bodies = bridgeColliderPoints(b);
      // One body per chord, then one per wall join.
      expect(bodies.length).toBe(sections.length - 1 + (b.wallJoins?.length ?? 0));
      const points = bodies.slice(0, sections.length - 1);
      points.forEach((p, i) => {
        const a = sections[i];
        const c = sections[i + 1];
        const tm = (a.t + c.t) / 2;
        for (const side of [1, -1] as const) {
          const standing = bridgeParapetAt(b, tm, side) && (BRIDGE_PARAPET_HEIGHT * (a.wall + c.wall)) / 2 >= 0.05;
          // At the chord's middle on the wall's line: its top face stands a wall's height over the slab,
          // or — no wall — only the slab's top is there.
          const w = side === 1 ? (a.wl + c.wl) / 2 : (a.wr + c.wr) / 2;
          const lat = side * (w - BRIDGE_PARAPET_WIDTH / 2);
          const x = (a.x + c.x) / 2 + ((a.ax + c.ax) / 2) * lat;
          const z = (a.z + c.z) / 2 + ((a.az + c.az) / 2) * lat;
          const slab = (a.y + a.slope * lat + c.y + c.slope * lat) / 2;
          const top = meshTopAt(p, x, z);
          const wallH = (BRIDGE_PARAPET_HEIGHT * (a.wall + c.wall)) / 2;
          if (standing) expect(top - slab).toBeGreaterThan(wallH - 0.6);
          else expect(Math.abs(top - slab)).toBeLessThan(0.6);
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("lofts a slab whose edges both advance between every two sections (no bow-tied quads)", () => {
    for (const b of decks) {
      const s = bridgeSections(b);
      const half = b.width / 2;
      for (let i = 0; i + 1 < s.length; i++) {
        const a = s[i];
        const c = s[i + 1];
        const dx = c.x - a.x;
        const dz = c.z - a.z;
        for (const side of [1, -1]) {
          const advance = (c.x + c.ax * side * half - a.x - a.ax * side * half) * dx + (c.z + c.az * side * half - a.z - a.az * side * half) * dz;
          // A bow-tie (an edge running backwards) drew a wedge-shaped hole through the deck.
          expect(advance).toBeGreaterThan(0);
        }
      }
    }
  });

  it("leaves no parapet standing inside a gap and cuts a T end's slab without a hole", () => {
    for (const b of decks) {
      for (const g of b.gaps ?? []) {
        expect(g.t1).toBeGreaterThan(g.t0);
        expect(bridgeParapetAt(b, (g.t0 + g.t1) / 2, g.side)).toBe(false);
      }
      const sections = bridgeSections(b);
      const points = bridgeColliderPoints(b).slice(0, sections.length - 1);
      for (const [cut, chord, end] of [
        [b.trimStartAxis, points[0], sections[0]],
        [b.trimEndAxis, points[points.length - 1], sections[sections.length - 1]],
      ] as const) {
        if (!cut) continue;
        // The mesh's top covers the cut section's full width (a crotch fillet runs it on along the host).
        const next = chord === points[0] ? sections[1] : sections[sections.length - 2];
        for (let k = -0.95; k <= 0.95; k += 0.1) {
          const lat = k * (k > 0 ? end.wl : end.wr);
          const x = end.x + end.ax * lat + (next.x - end.x) * 0.02;
          const z = end.z + end.az * lat + (next.z - end.z) * 0.02;
          expect(Number.isFinite(meshTopAt(chord, x, z))).toBe(true);
        }
      }
    }
  });

  it("ramps every landed end under the road across its whole width, the walls rising out of it", () => {
    let ends = 0;
    for (const b of decks) {
      const s = bridgeSections(b);
      for (const which of [0, 1] as const) {
        if (!b.landings?.[which]) continue;
        const end = which === 0 ? s[0] : s[s.length - 1];
        // An end cut along the road's edge starts at the road's own height at its two corners (a
        // crown between them may stand a little over the straight cut).
        const cut = which === 0 ? b.trimStartAxis : b.trimEndAxis;
        // The slab's end stood as a ledge over the asphalt wherever the road fell away across the deck.
        for (const k of [-1, -0.5, 0, 0.5, 1]) {
          const lat = (k * b.width) / 2;
          const ground = computeVertexData(end.x + end.ax * lat, end.z + end.az * lat).height;
          if (cut && Math.abs(k) === 1) expect(Math.abs(end.y + end.slope * lat - ground)).toBeLessThan(0.3);
          else expect(end.y + end.slope * lat).toBeLessThanOrEqual(ground + (cut ? 0.3 : 1e-3));
        }
        expect(end.wall).toBe(0);
        ends++;
      }
    }
    expect(ends).toBeGreaterThan(10);
  });

  it("keeps the collider's top ON the drawn top everywhere, cross-fall and twist included, and every pier under it", () => {
    let checked = 0;
    let worst = 0;
    for (const b of decks) {
      const sections = bridgeSections(b);
      const points = bridgeColliderPoints(b).slice(0, sections.length - 1);
      points.forEach((p, i) => {
        const a = sections[i];
        const c = sections[i + 1];
        for (const f of [0.1, 0.35, 0.65, 0.9]) {
          for (const k of [-0.8, -0.4, 0, 0.4, 0.8]) {
            // The ribbon's own top: the quad (aL, aR, cR, cL) split along aL–cR.
            const lat = (k * b.width) / 2;
            const x = a.x + (c.x - a.x) * f + (a.ax + (c.ax - a.ax) * f) * lat;
            const z = a.z + (c.z - a.z) * f + (a.az + (c.az - a.az) * f) * lat;
            const top = meshTopAt(p, x, z, Infinity);
            const under = meshTopAt(p, x, z, top - 0.01);
            // The top face is the highest surface there (walls stand only near the edges) and the
            // underside a deck's thickness under it.
            expect(Number.isFinite(top)).toBe(true);
            expect(top - under).toBeCloseTo(BRIDGE_DECK_THICKNESS, 4);
            // The drawn slab the terrain is cut under (the ribbon's own triangles).
            const drawn = bridgeDrawnTopAt(b, x, z);
            if (Number.isFinite(drawn)) worst = Math.max(worst, Math.abs(drawn - top));
            checked++;
          }
        }
      });
      for (const col of bridgePierColumns(b)) {
        // The column's top meets the slab's drawn underside over its whole footprint, never above it.
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const q = points.find((p) => Number.isFinite(meshTopAt(p, col.x + (dx * BRIDGE_PIER_SIZE) / 2, col.z + (dz * BRIDGE_PIER_SIZE) / 2)));
          if (!q) continue;
          expect(col.topY).toBeLessThanOrEqual(meshTopAt(q, col.x + (dx * BRIDGE_PIER_SIZE) / 2, col.z + (dz * BRIDGE_PIER_SIZE) / 2) - BRIDGE_DECK_THICKNESS + 1e-6);
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(worst).toBeLessThan(1e-4);
  });
});

describe("bridge ribbon", () => {
  it("faces every slab top up, even a T end's sweep with a near-zero triangle", () => {
    // (-8000, -13500): a Y whose child's first top quad (its cut to the first square section) has two
    // corners nearly coinciding; its normal came from that triangle and flipped the slab top over.
    const decks = [-31, -32].flatMap((gx) => [-53, -54].flatMap((gz) => getFreewayBridges(gx * 256, gz * 256, (gx + 1) * 256, (gz + 1) * 256, BRIDGE_PLACEMENT)));
    expect(decks.length).toBeGreaterThan(0);
    for (const b of decks) {
      const out = { positions: [] as number[], normals: [] as number[], colors: [] as number[], uvs: [] as number[], road: [] as number[] };
      bridgeRibbon(b, b.x, 0, b.z, 0, 0, out);
      const p = out.positions;
      for (let v = 0; v < p.length / 3; v += 3) {
        const [ax, , az, bx, , bz, cx, , cz] = p.slice(v * 3, v * 3 + 9);
        const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az); // twice the up-facing area
        // Only the road surface (road.w ≥ 1) and only real triangles (a zero-area one has no facing).
        const top = out.road[v * 4 + 3] >= 1 && Math.abs(ny) >= 0.01;
        expect(!top || ny > 0).toBe(true);
      }
    }
  });
});
