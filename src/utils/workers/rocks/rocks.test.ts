/** Rocks on the REAL pipeline with the overworld's config: chunk ownership, the mouths' rocks, and the
 *  lumps the client draws and the server collides. */
import { ROCK_SHAPES, rockLumpVertices } from "../../../objects/dressing/rocks/shapes";
import { ROCK_PLACEMENT, ROCKS_SPEC } from "../../../objects/dressing/rocks/spec";
import { DOMAIN_CONFIGS } from "../../../world/domains";
import { mouthSpots } from "../underground/caves";
import { systemAt } from "../underground/systems";
import type { TunnelSystem } from "../underground/types";
import { initCompute } from "../vertexCompute";
import { biomeSiteAt } from "../voronoi";
import { getRocks } from "./rockPlacement";
import { biomeIdOf } from "../../../world/content/config";

const MOUNTAIN_BIOME = { id: biomeIdOf(DOMAIN_CONFIGS.overworld, "mountain") };

const OVERWORLD_CONFIG = DOMAIN_CONFIGS.overworld;

jest.setTimeout(300000);

const MOUNTAIN = MOUNTAIN_BIOME.id;
const key = (p: { x: number; z: number }) => `${p.x.toFixed(4)}|${p.z.toFixed(4)}`;

let cave: TunnelSystem | null = null;

beforeAll(() => {
  initCompute(OVERWORLD_CONFIG);
  outer: for (let ring = 0; ring <= 40; ring++) {
    for (let ix = -ring; ix <= ring; ix++) {
      for (let iz = -ring; iz <= ring; iz++) {
        if (Math.max(Math.abs(ix), Math.abs(iz)) !== ring) continue;
        if (biomeSiteAt(ix, iz).zone.biome.id !== MOUNTAIN) continue;
        cave = systemAt("cave", MOUNTAIN, ix, iz);
        if (cave) break outer;
      }
    }
  }
  expect(cave).not.toBeNull();
});

describe("rock placement", () => {
  it("splits across chunks and repeats exactly", () => {
    const m = cave!.mouths[0];
    const x0 = Math.floor(m.ox / 256) * 256;
    const z0 = Math.floor(m.oz / 256) * 256;
    const whole = getRocks(x0, z0, x0 + 512, z0 + 512, ROCK_PLACEMENT);
    expect(whole.length).toBeGreaterThan(0);
    const parts = [
      ...getRocks(x0, z0, x0 + 256, z0 + 256, ROCK_PLACEMENT),
      ...getRocks(x0 + 256, z0, x0 + 512, z0 + 256, ROCK_PLACEMENT),
      ...getRocks(x0, z0 + 256, x0 + 256, z0 + 512, ROCK_PLACEMENT),
      ...getRocks(x0 + 256, z0 + 256, x0 + 512, z0 + 512, ROCK_PLACEMENT),
    ];
    expect(new Set(parts.map(key)).size).toBe(parts.length);
    expect(parts.map(key).sort()).toEqual(whole.map(key).sort());
    expect(getRocks(x0, z0, x0 + 512, z0 + 512, ROCK_PLACEMENT)).toEqual(whole);
    for (const r of whole) {
      expect(r.x).toBeGreaterThanOrEqual(x0);
      expect(r.x).toBeLessThan(x0 + 512);
      expect(r.variant).toBeGreaterThanOrEqual(0);
      expect(r.variant).toBeLessThan(ROCK_SHAPES.length);
      // Buried 20–50% of its height into its lowest ground.
      const buried = r.ground - (r.y - r.sy);
      expect(buried).toBeGreaterThanOrEqual(0.2 * 2 * r.sy - 1e-9);
      expect(buried).toBeLessThanOrEqual(0.5 * 2 * r.sy + 1e-9);
    }
  });

  it("stands at least a third of a mouth's spots", () => {
    const m = cave!.mouths[0];
    const spots = mouthSpots(m);
    expect(spots.length).toBeGreaterThan(0);
    const reach = 80;
    const rocks = getRocks(m.ox - reach, m.oz - reach, m.ox + reach, m.oz + reach, ROCK_PLACEMENT);
    const standing = spots.filter((s) => rocks.some((r) => Math.abs(r.x - s.x) < 1e-6 && Math.abs(r.z - s.z) < 1e-6));
    expect(standing.length).toBeGreaterThanOrEqual(spots.length / 3);
  });
});

describe("rock shapes", () => {
  it("are closed and wound outward", () => {
    for (const shape of ROCK_SHAPES) {
      const edges = new Map<string, number>();
      const p = shape.positions;
      for (let t = 0; t < shape.indices.length; t += 3) {
        const tri = [shape.indices[t], shape.indices[t + 1], shape.indices[t + 2]];
        for (let k = 0; k < 3; k++) {
          const a = tri[k];
          const b = tri[(k + 1) % 3];
          // Each directed edge once: the opposite direction belongs to the neighbour.
          const key = `${a}>${b}`;
          expect(edges.has(key)).toBe(false);
          edges.set(key, 1);
        }
        const [a, b, c] = tri.map((i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
        const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
        const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        expect(nx * (a[0] + b[0] + c[0]) + ny * (a[1] + b[1] + c[1]) + nz * (a[2] + b[2] + c[2])).toBeGreaterThan(0);
      }
      for (const [k] of edges) {
        const [a, b] = k.split(">");
        expect(edges.has(`${b}>${a}`)).toBe(true);
      }
    }
  });

  it("collide as exactly the drawn lump", () => {
    const m = cave!.mouths[0];
    const rocks = getRocks(m.ox - 80, m.oz - 80, m.ox + 80, m.oz + 80, ROCK_PLACEMENT);
    expect(rocks.length).toBeGreaterThan(0);
    for (const r of rocks.slice(0, 20)) {
      const [body] = ROCKS_SPEC.bodiesOf(r);
      expect(body.parts).toEqual([]);
      expect(body.yaw).toBe(r.yaw);
      expect(body.pitch).toBe(r.pitch);
      expect(body.mesh!.vertices).toEqual(rockLumpVertices(r.variant, r.sx, r.sy, r.sz));
      expect(body.mesh!.indices).toBe(ROCK_SHAPES[r.variant].indices);
    }
  });
});
