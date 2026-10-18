/** Tunnels on the REAL pipeline with the overworld's config: caves (mouths, grades, cover, radii, ragged
 *  openings, formations, rocks, determinism, the bulge, a chunk), the surface nets, and sewers (manholes,
 *  liquid, faces, plates, chunks, the floor's air). */
import { CITY_BIOME_ID, QUANTIZATION_GRID } from "../../../world/constants";
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { MOUNTAIN_BIOME } from "../../../world/domains/overworld/regions/snow/biomes/mountain/spec";
import { computeVertexData, computeVertexDataRaw, initCompute } from "../vertexCompute";
import { biomeSiteAt } from "../voronoi";
import { mouthSpots } from "./caves";
import { buildUndergroundChunk, setRockTestEnabled } from "./chunkMesh";
import { AXIS_LIFT, FLOOR_GRADE, LIQUID_BELOW_WALKWAY, MOUTH_STEEP_GRADE, OPENING_RADIUS_MAX, OPENING_RADIUS_MIN, PASSAGE_RADIUS_MAX, PASSAGE_RADIUS_MIN, POOL_DEPTH, ROCK_COVER, SEWER_DEPTH, SPRING_HALL_RADIUS, SPRING_SHARE_REACH, VOXEL } from "./constants";
import { drawnGroundAt } from "./drawnGround";
import { layoutPieces, mergeLayouts, type SewerSystem } from "./sewers";
import { buildSewerTriangles, liquidLevelOf } from "./sewerMesh";
import { meshBrick, NetVertices, type NetsOutput } from "./surfaceNets";
import { clearTunnelCaches, systemAt, systemsNear } from "./systems";
import { compileField, mouthFloorAt, mouthRadiusAt } from "./tunnelField";
import type { ConePiece, TubePiece, TunnelSystem, UndergroundChunk } from "./types";

jest.setTimeout(300000);

const config = OVERWORLD_CONFIG;
const MOUNTAIN = MOUNTAIN_BIOME.id;

/** The first cells of a biome (by site) around the origin, ring by ring. */
const cellsOf = (biomeId: number, max: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let ring = 0; ring <= 40 && out.length < max; ring++) {
    for (let ix = -ring; ix <= ring && out.length < max; ix++) {
      for (let iz = -ring; iz <= ring && out.length < max; iz++) {
        if (Math.max(Math.abs(ix), Math.abs(iz)) !== ring) continue;
        if (biomeSiteAt(ix, iz).zone.biome.id === biomeId) out.push([ix, iz]);
      }
    }
  }
  return out;
};

const firstSystem = (style: "cave" | "sewer", biomeId: number, tries: number): TunnelSystem => {
  for (const [ix, iz] of cellsOf(biomeId, tries)) {
    const s = systemAt(style, biomeId, ix, iz);
    if (s) return s;
  }
  throw new Error(`no ${style} system in the first ${tries} ${biomeId} cells`);
};

/** A short digest of a system's pieces (the spots are placed later, on demand). */
const digest = (s: TunnelSystem): string => {
  const text = JSON.stringify(s.pieces.map((p) => ({ ...p, spots: undefined })));
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${h >>> 0}`;
};

let cave: TunnelSystem;
let sewer: TunnelSystem;

beforeAll(() => {
  initCompute(config);
  cave = firstSystem("cave", MOUNTAIN, 12);
  sewer = firstSystem("sewer", CITY_BIOME_ID, 12);
});

describe("caves", () => {
  it("has a mouth on its ground, radii in range and a section no steeper than the limit", () => {
    expect(cave.mouths.length).toBeGreaterThan(0);
    for (const m of cave.mouths) {
      expect(Math.abs(computeVertexData(m.ox, m.oz).height - m.oy)).toBeLessThan(0.5);
      expect(m.r0).toBeGreaterThanOrEqual(OPENING_RADIUS_MIN);
      expect(m.r0).toBeLessThanOrEqual(OPENING_RADIUS_MAX);
      expect(m.r1).toBeGreaterThanOrEqual(PASSAGE_RADIUS_MIN);
      expect(m.r1).toBeLessThanOrEqual(PASSAGE_RADIUS_MAX);
      expect(m.grade).toBeLessThanOrEqual(MOUTH_STEEP_GRADE);
    }
  });

  it("keeps every tube's floor within the grade and the rock cover over both ends", () => {
    const tubes = cave.pieces.filter((p): p is TubePiece => p.kind === "tube");
    expect(tubes.length).toBeGreaterThan(0);
    for (const t of tubes) {
      const run = Math.hypot(t.bx - t.ax, t.bz - t.az);
      expect(Math.abs(t.by - t.ay)).toBeLessThanOrEqual(FLOOR_GRADE * run + 1e-9);
      expect(computeVertexData(t.ax, t.az).height - (t.ay + (1 + AXIS_LIFT) * t.ra)).toBeGreaterThanOrEqual(ROCK_COVER - 1e-6);
      expect(computeVertexData(t.bx, t.bz).height - (t.by + (1 + AXIS_LIFT) * t.rb)).toBeGreaterThanOrEqual(ROCK_COVER - 1e-6);
    }
  });

  it("opens ragged and runs round at the exact passage radius past the section", () => {
    const m = cave.mouths[0];
    const field = compileField([m]);
    const ringAt = (along: number, r: number): number[] => {
      const floor = mouthFloorAt(m, along);
      const axisY = floor + AXIS_LIFT * mouthRadiusAt(m, along);
      const vals: number[] = [];
      for (let k = 0; k < 12; k++) {
        const ang = ((k + 0.5) * 2 * Math.PI) / 12;
        if (Math.sin(ang) < -0.5) continue; // under the floor cut
        const l = Math.cos(ang) * r;
        const h = Math.sin(ang) * r;
        vals.push(field(m.ox + m.dx * along - m.dz * l, axisY + h, m.oz + m.dz * along + m.dx * l));
      }
      return vals;
    };
    const atOpening = ringAt(0.5, m.r0);
    const spread = Math.max(...atOpening) - Math.min(...atOpening);
    expect(spread).toBeGreaterThan(0.3);
    // At the inner end the outline is round at exactly the passage radius.
    for (const v of ringAt(m.length, m.r1)) expect(Math.abs(v)).toBeLessThan(0.08);
  });

  it("roots every formation in rock and ends it in air", () => {
    const cones = cave.pieces.filter((p): p is ConePiece => p.kind === "cone");
    const field = compileField(cave.pieces.filter((p) => p.kind !== "cone"));
    expect(cones.length).toBeGreaterThan(0);
    for (const c of cones) {
      expect(field(c.x, c.y, c.z)).toBeGreaterThan(0);
      expect(field(c.x, c.y + c.dir * c.length, c.z)).toBeLessThan(0);
    }
  });

  it("lists at least ten rock spots per mouth", () => {
    for (const m of cave.mouths) expect(mouthSpots(m).length).toBeGreaterThanOrEqual(10);
  });

  it("generates the same cave after its caches are cleared, and bulges the ground beside the opening", () => {
    const before = digest(cave);
    clearTunnelCaches();
    const again = systemAt("cave", MOUNTAIN, cave.ix, cave.iz);
    expect(again).not.toBeNull();
    expect(digest(again!)).toBe(before);
    cave = again!;
    const m = cave.mouths[0];
    const lateral = m.r0 * 1.5;
    const x = m.ox - m.dz * lateral;
    const z = m.oz + m.dx * lateral;
    expect(computeVertexData(x, z).height - computeVertexDataRaw(x, z).height).toBeGreaterThan(0);
  });

  it("builds a chunk with finite buffers, colliders, its entrance and daylight from full to none", () => {
    const m = cave.mouths[0];
    const minX = Math.floor(m.ox / 256) * 256;
    const minZ = Math.floor(m.oz / 256) * 256;
    const chunk = buildUndergroundChunk({ minX, minZ, maxX: minX + 256, maxZ: minZ + 256 }, "cave", MOUNTAIN);
    expect(chunk).not.toBeNull();
    const c = chunk as UndergroundChunk;
    for (const arr of [c.mesh.positions, c.mesh.normals, c.mesh.colors, c.mesh.daylight]) for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i])).toBe(true);
    expect(c.mesh.indices.length).toBeGreaterThan(0);
    expect(c.colliders.length).toBeGreaterThan(0);
    expect(c.entrances.some((e) => e.id === m.id)).toBe(true);
    expect(c.entranceMouths.some((e) => e.id === m.id)).toBe(true);
    expect(c.patch).not.toBeNull();
    let max = 0;
    let min = 1;
    for (let i = 0; i < c.mesh.daylight.length; i++) {
      max = Math.max(max, c.mesh.daylight[i]);
      min = Math.min(min, c.mesh.daylight[i]);
    }
    for (let i = 0; i < c.patch!.entranceRock.length; i += 2) max = Math.max(max, c.patch!.entranceRock[i + 1]);
    expect(max).toBeGreaterThan(0.9);
    expect(min).toBeLessThan(0.05);
  });

  it("skips provably-rock bricks without changing a bit of the mesh", () => {
    const m = cave.mouths[0];
    const minX = Math.floor((m.ox + m.dx * (m.length + 40)) / 256) * 256;
    const minZ = Math.floor((m.oz + m.dz * (m.length + 40)) / 256) * 256;
    const bounds = { minX, minZ, maxX: minX + 256, maxZ: minZ + 256 };
    setRockTestEnabled(false);
    const full = buildUndergroundChunk(bounds, "cave", MOUNTAIN)!;
    setRockTestEnabled(true);
    const skipped = buildUndergroundChunk(bounds, "cave", MOUNTAIN)!;
    expect(skipped.mesh.positions).toEqual(full.mesh.positions);
    expect(skipped.mesh.indices).toEqual(full.mesh.indices);
    expect(skipped.mesh.normals).toEqual(full.mesh.normals);
  });

  it("connects two springs that meet in the rock through one hall, and pools neither (Evan at (-6615, 8821))", () => {
    const area = { minX: -6615 - 300, minZ: 8821 - 300, maxX: -6615 + 300, maxZ: 8821 + 300 };
    const springs = systemsNear("cave", MOUNTAIN, area).filter((s) => s.key.startsWith("spring|"));
    expect(springs.length).toBeGreaterThanOrEqual(2);
    const rooms = springs.filter((s) => s.pieces.some((piece) => piece.kind === "room"));
    const halls = springs.filter((s) => s.pieces.some((piece) => piece.kind === "tube" && (piece as TubePiece).ra === SPRING_HALL_RADIUS && (piece as TubePiece).rb === SPRING_HALL_RADIUS));
    // Stacked pools: two rooms within a hall's reach of each other.
    for (const a of rooms) {
      for (const b of rooms) {
        if (a === b) continue;
        const d = Math.hypot(a.mouths[0].ox - b.mouths[0].ox, a.mouths[0].oz - b.mouths[0].oz);
        expect(d).toBeGreaterThan(SPRING_SHARE_REACH);
      }
    }
    expect(halls.length).toBeGreaterThanOrEqual(1);
    // The paired springs agree from both cells: a hall holder's partner (the other spring whose mouth is
    // within reach) has neither a room nor a hall of its own.
    for (const h of halls) {
      const partners = springs.filter((s) => s !== h && Math.hypot(s.mouths[0].ox - h.mouths[0].ox, s.mouths[0].oz - h.mouths[0].oz) < SPRING_SHARE_REACH * 2);
      expect(partners.length).toBeGreaterThanOrEqual(1);
      for (const s of partners) expect(rooms.includes(s)).toBe(false);
    }
  });
});

describe("surface nets", () => {
  it("meshes a sphere across two bricks closed, manifold and facing the air", () => {
    const field = (x: number, y: number, z: number): number => Math.hypot(x - 16, y - 8, z - 8) - 6;
    const out: NetsOutput = { positions: [], normals: [], indices: [] };
    const shared = new NetVertices(0, 0);
    meshBrick(field, 0, 0, 0, shared, out);
    meshBrick(field, 16, 0, 0, shared, out);
    const edges = new Map<string, number>();
    for (let t = 0; t < out.indices.length; t += 3) {
      const tri = [out.indices[t], out.indices[t + 1], out.indices[t + 2]];
      for (let k = 0; k < 3; k++) {
        const a = tri[k];
        const b = tri[(k + 1) % 3];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
      const p = (i: number) => [out.positions[i * 3], out.positions[i * 3 + 1], out.positions[i * 3 + 2]];
      const [a, b, c] = tri.map(p);
      const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      const cx = (a[0] + b[0] + c[0]) / 3 - 16;
      const cy = (a[1] + b[1] + c[1]) / 3 - 8;
      const cz = (a[2] + b[2] + c[2]) / 3 - 8;
      // Facing the air: into the sphere.
      expect(n[0] * cx + n[1] * cy + n[2] * cz).toBeLessThan(0);
    }
    expect(edges.size).toBeGreaterThan(0);
    for (const count of edges.values()) expect(count).toBe(2);
  });
});

describe("sewers", () => {
  it("puts its manholes on a street and its floors under it", () => {
    expect(sewer.entrances.length).toBeGreaterThan(0);
    for (const e of sewer.entrances) {
      expect(Math.abs(computeVertexData(e.x, e.z).height - e.y)).toBeLessThan(1);
      expect(e.manhole!.floorY).toBeCloseTo(e.manhole!.streetY - SEWER_DEPTH, -1);
    }
    const layout = (sewer as SewerSystem).layout;
    for (const n of layout.nodes.values()) expect(n.floor).toBeCloseTo(n.street - SEWER_DEPTH, 6);
  });

  it("draws only level, plumb or arch faces, wound to face the air", () => {
    const layout = mergeLayouts(sewer.district!, [sewer]);
    const tri = buildSewerTriangles(layout);
    const streets = layout.streets.map((s) => {
      const a = layout.nodes.get(s.a)!;
      const b = layout.nodes.get(s.b)!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      return [(b.x - a.x) / len, (b.z - a.z) / len];
    });
    for (let t = 0; t < tri.positions.length / 9; t++) {
      const n = [tri.normals[t * 9], tri.normals[t * 9 + 1], tri.normals[t * 9 + 2]];
      const level = Math.abs(n[1]) > 0.999;
      const plumb = Math.abs(n[1]) < 0.001;
      const arch = streets.some(([dx, dz]) => Math.abs(n[0] * dx + n[2] * dz) < 0.01);
      expect(level || plumb || arch).toBe(true);
    }
  });

  it("builds a chunk whose triangles it holds, with liquid under the walkways and every floor point in air", () => {
    const e = sewer.entrances[0];
    const minX = Math.floor(e.x / 256) * 256;
    const minZ = Math.floor(e.z / 256) * 256;
    const rect = { minX, minZ, maxX: minX + 256, maxZ: minZ + 256 };
    const started = performance.now();
    const chunk = buildUndergroundChunk(rect, "sewer", CITY_BIOME_ID);
    const first = performance.now() - started;
    const again = performance.now();
    buildUndergroundChunk(rect, "sewer", CITY_BIOME_ID);
    console.log(`sewer chunk: ${Math.round(first)}ms cold, ${Math.round(performance.now() - again)}ms warm, ${chunk ? chunk.mesh.indices.length / 3 : 0} triangles`);
    expect(chunk).not.toBeNull();
    const c = chunk as UndergroundChunk;
    const pos = c.mesh.positions;
    const idx = c.mesh.indices;
    const probe = compileField(c.pieces, { withCones: false });
    let floorPoints = 0;
    const bad: unknown[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let k = 0; k < 3; k++) {
        cx += pos[idx[t + k] * 3] / 3;
        cy += pos[idx[t + k] * 3 + 1] / 3;
        cz += pos[idx[t + k] * 3 + 2] / 3;
      }
      const x = cx + c.centerX;
      const z = cz + c.centerZ;
      // Ownership was decided in float64; the buffers are float32.
      const slack = 0.05;
      expect(x).toBeGreaterThanOrEqual(minX - slack);
      expect(x).toBeLessThan(minX + 256 + slack);
      expect(z).toBeGreaterThanOrEqual(minZ - slack);
      expect(z).toBeLessThan(minZ + 256 + slack);
      const ny = c.mesh.normals[idx[t] * 3 + 1];
      // A level face is a floor, or the street's rim around a shaft (open to the sky). Probed 0.6 over
      // its middle: across a concave corner (the arch foot on the walkway) a triangle's chord dips up to
      // 0.35u into the rock.
      if (ny > 0.9) {
        floorPoints++;
        const over = Math.min(probe(x, cy + 0.6, z), drawnGroundAt(x, z) - (cy + 0.6));
        if (!(over < 0)) {
          const corners = [0, 1, 2].map((k) => [pos[idx[t + k] * 3] + c.centerX, pos[idx[t + k] * 3 + 1], pos[idx[t + k] * 3 + 2] + c.centerZ, c.mesh.normals[idx[t + k] * 3 + 1]].map((v) => +v.toFixed(3)));
          bad.push({ x: +x.toFixed(2), y: +cy.toFixed(2), z: +z.toFixed(2), ny: +ny.toFixed(3), at: +probe(x, cy, z).toFixed(3), over: +over.toFixed(3), corners });
        }
      }
    }
    expect(floorPoints).toBeGreaterThan(0);
    if (bad.length > 0) console.log(JSON.stringify(bad.slice(0, 6)));
    expect(bad.length).toBe(0);
    expect(c.liquid).not.toBeNull();
    const layout = mergeLayouts(sewer.district!, [sewer]);
    for (const n of layout.nodes.values()) {
      if (n.x < minX || n.x >= minX + 256 || n.z < minZ || n.z >= minZ + 256) continue;
      const level = liquidLevelOf(c.liquid!, n.x - c.centerX, n.z - c.centerZ);
      // The liquid is snapped to the shader's lattice like the walls (sewerMesh.ts): within half a step.
      expect(Math.abs(level - (n.floor - LIQUID_BELOW_WALKWAY))).toBeLessThanOrEqual(QUANTIZATION_GRID / 2 + 1e-6);
      if (n.room) expect(level - (n.floor - POOL_DEPTH)).toBeGreaterThan(1.8);
    }
  });

  it("caps every tube its border cuts, on the border, facing in, keyed by the chunk across it", () => {
    const e = sewer.entrances[0];
    const minX = Math.floor(e.x / 256) * 256;
    const minZ = Math.floor(e.z / 256) * 256;
    const c = buildUndergroundChunk({ minX, minZ, maxX: minX + 256, maxZ: minZ + 256 }, "sewer", CITY_BIOME_ID) as UndergroundChunk;
    const borders: Record<string, { axis: 0 | 2; at: number; inward: number }> = {
      [`${minX - 256},${minZ}`]: { axis: 0, at: minX, inward: 1 },
      [`${minX + 256},${minZ}`]: { axis: 0, at: minX + 256, inward: -1 },
      [`${minX},${minZ - 256}`]: { axis: 2, at: minZ, inward: 1 },
      [`${minX},${minZ + 256}`]: { axis: 2, at: minZ + 256, inward: -1 },
    };
    const probe = compileField(c.pieces, { withCones: false });
    for (const cap of c.caps) {
      const border = borders[cap.neighbor];
      expect(border).toBeDefined();
      const pos = cap.mesh.positions;
      const idx = cap.mesh.indices;
      expect(idx.length).toBeGreaterThan(0);
      const abs = (i: number): [number, number, number] => [pos[i * 3] + c.centerX, pos[i * 3 + 1], pos[i * 3 + 2] + c.centerZ];
      for (let i = 0; i < pos.length / 3; i++) {
        const v = abs(i);
        expect(Math.abs(v[border.axis] - border.at)).toBeLessThan(0.01);
        const along = v[border.axis === 0 ? 2 : 0];
        expect(along).toBeGreaterThanOrEqual((border.axis === 0 ? minZ : minX) - 1);
        expect(along).toBeLessThanOrEqual((border.axis === 0 ? minZ : minX) + 257);
        expect(cap.mesh.normals[i * 3 + border.axis] * border.inward).toBeGreaterThan(0.99);
      }
      let inAir = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const [a, b, d] = [abs(idx[t]), abs(idx[t + 1]), abs(idx[t + 2])];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        // Wound to face into the chunk.
        expect(n[border.axis] * border.inward).toBeGreaterThan(0);
        if (probe(a[0], a[1], a[2]) < 0) inAir++;
      }
      // Every polygon is fanned from its centre (its first vertex): a pipe's section is centred in the air.
      expect(inAir).toBeGreaterThan(0);
    }
    // Every street of the system whose pipe crosses a border has a cap toward the chunk across it.
    const layout = mergeLayouts(sewer.district!, [sewer]);
    const keys = new Set(c.caps.map((cap) => cap.neighbor));
    let crossings = 0;
    for (const st of layout.streets) {
      const a = layout.nodes.get(st.a)!;
      const b = layout.nodes.get(st.b)!;
      for (const [key, border] of Object.entries(borders)) {
        const pa = border.axis === 0 ? a.x : a.z;
        const pb = border.axis === 0 ? b.x : b.z;
        if ((pa - border.at) * (pb - border.at) >= 0) continue;
        const t = (border.at - pa) / (pb - pa);
        const along = border.axis === 0 ? a.z + (b.z - a.z) * t : a.x + (b.x - a.x) * t;
        const lo = border.axis === 0 ? minZ : minX;
        if (along < lo || along >= lo + 256) continue;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (t * len < 13 || (1 - t) * len < 13) continue; // within a box, capped by the box's rectangle
        crossings++;
        expect(keys.has(key)).toBe(true);
      }
    }
    console.log(`sewer caps: ${c.caps.length} borders, ${c.caps.reduce((n, cap) => n + cap.mesh.indices.length / 3, 0)} triangles, ${crossings} pipe crossings`);
  });
});

