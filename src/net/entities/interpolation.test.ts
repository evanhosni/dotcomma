import {
  advanceRenderClock,
  INTERP_DELAY_MS,
  MAX_EXTRAPOLATION_MS,
  PUBLISH_INTERVAL_MS,
  pruneSnapshots,
  pushSnapshot,
  sampleSnapshots,
  type SampledPose,
  type Snapshot,
} from "./interpolation";

const snap = (st: number, x: number, z: number, vx = 0, vz = 0, ry = 0): Snapshot => ({ st, x, y: 1, z, ry, vx, vy: 0, vz });
const pose = (): SampledPose => ({ x: 0, y: 0, z: 0, ry: 0, vx: 0, vy: 0, vz: 0 });

describe("snapshot interpolation", () => {
  test("interpolates linearly between the two bracketing snapshots", () => {
    const s = [snap(1000, 0, 0, 5, 0), snap(1100, 0.5, 0, 5, 0), snap(1200, 1.0, 0, 5, 0)];
    const out = pose();
    expect(sampleSnapshots(s, 1050, out)).toBe("interp");
    expect(out.x).toBeCloseTo(0.25);
    expect(out.vx).toBeCloseTo(5);
    expect(sampleSnapshots(s, 1150, out)).toBe("interp");
    expect(out.x).toBeCloseTo(0.75);
  });

  test("a stop is reached exactly, with no overshoot and no slide back", () => {
    // Walking at 5u/s, then a stop snapshot with v=0 at the same place.
    const s = [snap(1000, 0, 0, 5, 0), snap(1100, 0.5, 0, 5, 0), snap(1200, 0.5, 0, 0, 0), snap(1300, 0.5, 0, 0, 0)];
    const out = pose();
    for (let t = 1100; t <= 1300; t += 16) {
      sampleSnapshots(s, t, out);
      expect(out.x).toBeLessThanOrEqual(0.5 + 1e-9);
    }
    sampleSnapshots(s, 1250, out);
    expect(out.x).toBeCloseTo(0.5);
    expect(out.vx).toBe(0);
  });

  test("arrival timing is irrelevant: the same snapshots give the same pose however they were delivered", () => {
    const a: Snapshot[] = [];
    const b: Snapshot[] = [];
    const src = [snap(1000, 0, 0, 5, 0), snap(1100, 0.5, 0, 5, 0), snap(1200, 1, 0, 5, 0)];
    for (const x of src) pushSnapshot(a, x);
    // "Bunched" delivery: same samples, pushed out of order and duplicated.
    pushSnapshot(b, src[0]);
    pushSnapshot(b, src[2]);
    pushSnapshot(b, src[1]); // older than the last → dropped, but…
    pushSnapshot(b, src[2]); // …same st replaces
    const oa = pose();
    const ob = pose();
    sampleSnapshots(a, 1150, oa);
    sampleSnapshots(b, 1150, ob);
    // b lacks the 1100 sample so it lerps 1000→1200: identical on a straight line.
    expect(ob.x).toBeCloseTo(oa.x);
  });

  test("an idle gap is a HOLD, not a creep: the entity stands still until one publish interval before it moved", () => {
    // Stopped at x=10 (st 1000), nothing published for 5s, first moving tick at st 6000 (x=10.5).
    const s = [snap(1000, 10, 0, 0, 0), snap(6000, 10.5, 0, 5, 0)];
    const out = pose();
    for (const t of [1500, 3000, 5800, 6000 - PUBLISH_INTERVAL_MS - 1]) {
      expect(sampleSnapshots(s, t, out)).toBe("hold");
      expect(out.x).toBe(10);
    }
    expect(sampleSnapshots(s, 6000 - PUBLISH_INTERVAL_MS / 2, out)).toBe("interp");
    expect(out.x).toBeCloseTo(10.25);
    expect(out.vx).toBeCloseTo(5);
    // The frame the moving snapshot ARRIVES (render clock ~200ms behind 6000)
    // the pose is still at 10 — no hop.
    sampleSnapshots(s, 6000 - INTERP_DELAY_MS, out);
    expect(out.x).toBe(10);
  });

  test("past the newest snapshot: brief extrapolation, then hold", () => {
    const s = [snap(1000, 0, 0, 5, 0)];
    const out = pose();
    expect(sampleSnapshots(s, 1100, out)).toBe("extrap");
    expect(out.x).toBeCloseTo(0.5);
    expect(sampleSnapshots(s, 1000 + MAX_EXTRAPOLATION_MS + 1000, out)).toBe("hold");
    expect(out.x).toBeCloseTo((5 * MAX_EXTRAPOLATION_MS) / 1000);
    expect(out.vx).toBe(0);
  });

  test("before the first snapshot: hold the first (a freshly registered entity sits at its spawn)", () => {
    const s = [snap(5000, 3, 4)];
    const out = pose();
    expect(sampleSnapshots(s, 5000 - INTERP_DELAY_MS, out)).toBe("hold");
    expect(out.x).toBe(3);
    expect(out.z).toBe(4);
  });

  test("a relocation (server restart, respawn) is not interpolated across", () => {
    const s = [snap(1000, 0, 0), snap(1100, 300, 0)];
    const out = pose();
    expect(sampleSnapshots(s, 1050, out)).toBe("hold");
    expect(out.x).toBe(0);
    sampleSnapshots(s, 1100, out);
    expect(out.x).toBe(300);
  });

  test("yaw takes the short way round", () => {
    const s = [snap(1000, 0, 0, 0, 0, Math.PI - 0.1), snap(1100, 0, 0, 0, 0, -Math.PI + 0.1)];
    const out = pose();
    sampleSnapshots(s, 1050, out);
    expect(Math.abs(Math.abs(out.ry) - Math.PI)).toBeLessThan(1e-9);
  });

  test("pruning keeps history the render time still needs and never fewer than two", () => {
    const s: Snapshot[] = [];
    for (let i = 0; i < 20; i++) pushSnapshot(s, snap(1000 + i * 100, i, 0));
    pruneSnapshots(s, 2500);
    expect(s[0].st).toBeGreaterThanOrEqual(1400); // ≥ renderTime − keep − one segment
    expect(s.length).toBeGreaterThanOrEqual(2);
    const two = [snap(0, 0, 0), snap(100, 1, 0)];
    pruneSnapshots(two, 1e9);
    expect(two.length).toBe(2);
  });

  test("the render clock slews toward its target instead of stepping, and snaps only when far off", () => {
    // 30ms behind: converges over frames, never moving more than 10% fast.
    let c = 1000;
    let prev = c;
    for (let i = 0; i < 60; i++) {
      c = advanceRenderClock(c, 16, 1030 + (i + 1) * 16);
      expect(c - prev).toBeLessThanOrEqual(16 * 1.1 + 1e-9);
      expect(c - prev).toBeGreaterThanOrEqual(16 * 0.9 - 1e-9);
      prev = c;
    }
    expect(Math.abs(c - (1030 + 60 * 16))).toBeLessThan(2);
    expect(advanceRenderClock(1000, 16, 5000)).toBe(5000);
    expect(advanceRenderClock(NaN, 16, 777)).toBe(777);
  });
});
