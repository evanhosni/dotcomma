/** The rivers never break the ground or resume their bed (water/DECISIONS.md "Cliffs at the field's edge"):
 *  no height step a river made — a jump that does not shrink as the samples close in — anywhere in a
 *  sweep of Evan's cliff spot, five 3 km squares and the ponds; and round every pond and along every
 *  river, once the bed paint is cut going outward it never comes back. */
import { DOMAIN_CONFIGS } from "../../../../world/domains";
import { RIVER_BED_BLEND_WIDTH, RIVER_BED_FADE_INSET } from "../../../../world/shaders/constants";
import { smoothstep } from "../../../math";
import { bankGroundAt, computeVertexData, initCompute, unwarp, warp } from "../../vertexCompute";
import { zoneFinal, zones } from "../../zoneBlend";
import { pondDiscsIn } from "../ponds";
import { riverPiecesNear } from "./network";
import { meandered, riverFieldAt, riverSample, unmeander } from "./field";
import { waterGroundAt } from "../utils";
import { mouthsNear } from "../../underground/mouthBulge";

const CONFIG = DOMAIN_CONFIGS.overworld;
const REACH = CONFIG.river.halfWidth + CONFIG.river.bank;

/** A pair of samples is suspect where the height moved this much more than the un-rivered ground did. */
const SUSPECT = 8;
/** Refined to 1/16 of the spacing, no sub-step may rise steeper than this: the steepest the world's own
 *  ground, walls and banks reach in the census is 8.4; a discontinuity grows without bound as it is
 *  refined (the cliffs measured 60–2300). */
const MAX_FINE_SLOPE = 12;

const heightAt = (x: number, z: number): number => computeVertexData(x, z).height;
const naturalAt = (x: number, z: number): number => {
  const w = warp(x, z);
  return waterGroundAt(w.x, w.z).h;
};

/** Every river-made step in a square (centre, half-size, spacing): "x,z slope" for each. */
const stepsIn = (cx: number, cz: number, R: number, S: number): string[] => {
  const N = Math.round((2 * R) / S) + 1;
  const h = new Float64Array(N * N);
  const g = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      h[i * N + j] = heightAt(cx - R + i * S, cz - R + j * S);
      g[i * N + j] = naturalAt(cx - R + i * S, cz - R + j * S);
    }
  }
  const out: string[] = [];
  const check = (a: number, b: number, x: number, z: number, dx: number, dz: number): void => {
    if (Math.abs(h[a] - h[b]) - Math.abs(g[a] - g[b]) <= SUSPECT) return;
    // A cave mouth's bulge is the caves' own shape (underground/DECISIONS.md), not a river's.
    if (mouthsNear(x, z).length > 0 || mouthsNear(x + dx, z + dz).length > 0) return;
    let prev = heightAt(x, z);
    for (let k = 1; k <= 16; k++) {
      const next = heightAt(x + (dx * k) / 16, z + (dz * k) / 16);
      const slope = (Math.abs(next - prev) * 16) / S;
      if (slope > MAX_FINE_SLOPE) {
        out.push(`(${x.toFixed(0)}, ${z.toFixed(0)}) ${slope.toFixed(0)}`);
        return;
      }
      prev = next;
    }
  };
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = cx - R + i * S;
      const z = cz - R + j * S;
      if (i + 1 < N) check(i * N + j, (i + 1) * N + j, x, z, S, 0);
      if (j + 1 < N) check(i * N + j, i * N + j + 1, x, z, 0, S);
    }
  }
  return out;
};

/** A fixed pseudo-random pick of n from a list. */
function sample<T>(list: T[], n: number, seed: number): T[] {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  return list
    .map((v) => [rnd(), v] as const)
    .sort((a, b) => a[0] - b[0])
    .slice(0, n)
    .map((p) => p[1]);
}

describe("river-made height steps", () => {
  beforeAll(() => initCompute(CONFIG));

  it("are none at Evan's cliff spot (-4133.5, -16744.9)", () => {
    expect(stepsIn(-4133.5, -16744.9, 750, 4)).toEqual([]);
  }, 600000);

  it("are none round Evan's summit pond grown to its biome's pondMinRadius (11324.9, -8950.1)", () => {
    const w = warp(11324.9, -8950.1);
    const pond = pondDiscsIn(w.x - 600, w.z - 600, w.x + 600, w.z + 600)[0];
    expect(pond.width * CONFIG.river.halfWidth).toBeGreaterThanOrEqual(75 - 1e-9);
    const c = unwarp(pond.x, pond.z);
    expect(stepsIn(c.x, c.z, 500, 4)).toEqual([]);
  }, 600000);

  // A river ending ROUND (no <Pond riverEnd> rolled): at full width in the salt, and at a mountain's foot.
  it.each([
    ["salt", -737, 3505],
    ["mountain foot", -4707, -15967],
  ])("are none round a river's round end: %s", (_name, x, z) => {
    expect(stepsIn(x, z, 400, 4)).toEqual([]);
  }, 600000);

  it.each([
    ["mountain", 11636, -8825],
    ["desert", 6000, 0],
    ["massif", 9870, -9864],
    ["gorge", -2163, 14206],
    ["lake mouths", -7632, 11976],
  ])("are none over a 3 km square: %s", (_name, x, z) => {
    expect(stepsIn(x, z, 1500, 8)).toEqual([]);
  }, 600000);

  it("are none round a sample of the ponds world-wide", () => {
    const discs = sample(pondDiscsIn(-20000, -20000, 20000, 20000), 16, 12345);
    expect(discs.length).toBe(16);
    const steps: string[] = [];
    for (const d of discs) {
      const c = unwarp(d.x, d.z);
      steps.push(...stepsIn(c.x, c.z, 400, 4));
    }
    expect(steps).toEqual([]);
  }, 600000);
});

describe("the bed paint, going outward from the water", () => {
  beforeAll(() => initCompute(CONFIG));

  /** How much of the bed the shader hides at a point of slope `slope` (rise per unit): its yield fade (the
   *  mountain's 30° to 40°) times the ground's yielding share (combineBiomeMaterials `bedSteep`). */
  const hiddenAt = (x: number, z: number, slope: number): number => {
    bankGroundAt(x, z);
    let rock = 0;
    for (let i = 0; i < zones.length; i++) if (zones[i].biome.bedYieldSlope) rock += zoneFinal[i];
    return smoothstep(Math.tan(Math.PI / 6), Math.tan((40 * Math.PI) / 180), slope) * Math.min(rock, 1);
  };
  /** Along a ray until it turns toward another water: the distance (u) past the cut at which a plainly
   *  VISIBLE bed stood (while it heads outward at at least half the radial rate; rays in the field's meandered warped space) (at least half its paint, at most a quarter hidden), or 0. Cut: unpainted, or at
   *  least half hidden over two samples, past the half-width (inside it the channel's own bank keeps its bed). A bed within 12u of its cut is the cap's fade (or a crease narrower than the
   *  limit's 2.5u march steps). */
  const resumedAlong = (wx: number, wz: number, dx: number, dz: number): number => {
    let cutAt = -1;
    let prev = -Infinity;
    let hiddenBefore = false;
    for (let s = 0; s <= 500; s += 2) {
      unmeander(wx + dx * s, wz + dz * s);
      const px = meandered.x;
      const pz = meandered.z;
      const { x, z } = unwarp(px, pz);
      const v = computeVertexData(x, z);
      riverFieldAt(px, pz, false, false);
      // Outward only: a ray sliding along a shore reads the bed of another stretch of it.
      if (v.distanceToRiverCenter - prev < 1 / riverSample.factor) return 0;
      prev = v.distanceToRiverCenter;
      if (v.waterDepth > 0) continue;
      const slope = Math.hypot(heightAt(x + 1, z) - heightAt(x - 1, z), heightAt(x, z + 1) - heightAt(x, z - 1)) / 2;
      const painted = v.riverBedDistance < REACH - RIVER_BED_FADE_INSET;
      const hidden = painted ? hiddenAt(x, z, slope) : 1;
      if (cutAt < 0) {
        // Two samples running (4u): a crease narrower than the limit's 2.5u march steps cuts nothing.
        const steep = hidden >= 0.5 && v.distanceToRiverCenter >= CONFIG.river.halfWidth;
        if (steep && hiddenBefore) cutAt = s;
        hiddenBefore = steep;
      } else if (v.riverBedDistance < REACH - RIVER_BED_FADE_INSET - RIVER_BED_BLEND_WIDTH / 2 && hidden < 0.25 && s - cutAt > 12) return s - cutAt;
    }
    return 0;
  };

  it("never resumes once cut round a pond (Evan's mountain pond at (-4817, -16829) among them)", () => {
    const all = pondDiscsIn(-20000, -20000, 20000, 20000);
    // Evan's mountain pond and his summit pond at its minimum size among them.
    const discs = [...all.filter((d) => Math.hypot(d.x + 4817, d.z + 16840) < 50 || Math.hypot(d.x - 11218, d.z + 8780) < 50), ...sample(all, 20, 777)];
    expect(discs.length).toBe(22);
    const resumed: string[] = [];
    for (const d of discs) {
      for (let m = 0; m < 16; m++) {
        const a = ((m + 0.37) * Math.PI) / 8;
        const past = resumedAlong(d.x, d.z, Math.cos(a), Math.sin(a));
        if (past > 0) resumed.push(`(${d.x.toFixed(0)}, ${d.z.toFixed(0)}) ray ${m}: ${past}u past its cut`);
      }
    }
    expect(resumed).toEqual([]);
  }, 600000);

  it("never resumes once cut beside a river", () => {
    // Away from the ponds (their own rays test them): beside one, the pond owns the bed past the river's bank.
    const discs = pondDiscsIn(-8500, -8500, 8500, 8500);
    const clear = riverPiecesNear(-8000, -8000, 8000, 8000, 0).filter((p) => discs.every((d) => Math.hypot(p.sx - d.x, p.sz - d.z) > REACH * d.width * 2 + 100));
    const pieces = sample(clear, 60, 4242);
    const resumed: string[] = [];
    for (const p of pieces) {
      const t = 0.37;
      for (const side of [1, -1]) {
        const past = resumedAlong(p.sx + (p.ex - p.sx) * t, p.sz + (p.ez - p.sz) * t, -p.edge.uz * side, p.edge.ux * side);
        if (past > 0) resumed.push(`${p.edge.key}:${p.index} side ${side}: ${past}u past its cut`);
      }
    }
    expect(resumed).toEqual([]);
  }, 600000);
});
