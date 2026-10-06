import type { ClientEntity } from "./entityStore";
import { INTERP_DELAY_MS, pushSnapshot, sampleSnapshots, type SampledPose, type Snapshot } from "./interpolation";
import { PosePlayback } from "./posePlayback";
import type { PuppetTarget } from "./useSyncedEntity";

let mockServerTime = 0;
jest.mock("../connection", () => ({ getServerTime: () => mockServerTime }));

const snap = (st: number, x: number, vx = 0): Snapshot => ({ st, x, y: 2, z: -x, ry: 0.5, vx, vy: 0, vz: 0 });
const entityOf = (snapshots: Snapshot[]): ClientEntity =>
  ({ id: "e", kind: "k", origin: { x: 0, y: 0, z: 0 }, remote: null, snapshots, listeners: new Set() }) as ClientEntity;
const target = (): PuppetTarget => ({ valid: false, x: 0, y: 0, z: 0, ry: 0, vx: 0, vy: 0, vz: 0 });

describe("PosePlayback", () => {
  test("a track held on its lone snapshot keeps the exact pose a full sample gives, and follows new snapshots", () => {
    mockServerTime = 10_000;
    const snapshots = [snap(10_000 - INTERP_DELAY_MS - 50, 4, 1.5)];
    const entity = entityOf(snapshots);
    const playback = new PosePlayback();
    const t = target();
    const expected: SampledPose = { x: 0, y: 0, z: 0, ry: 0, vx: 0, vy: 0, vz: 0 };
    for (let frame = 0; frame < 120; frame++) {
      mockServerTime += 16;
      if (frame === 60) pushSnapshot(snapshots, snap(mockServerTime - INTERP_DELAY_MS + 40, 6, 0));
      if (frame === 90) snapshots.splice(0, snapshots.length - 1); // pruned back to a lone snapshot
      playback.sample(entity, 0.016, t);
      sampleSnapshots(snapshots, playback.renderTime, expected);
      expect(t.valid).toBe(true);
      expect([t.x, t.y, t.z, t.ry, t.vx, t.vy, t.vz]).toEqual([expected.x, expected.y, expected.z, expected.ry, expected.vx, expected.vy, expected.vz]);
    }
  });

  test("a new target object is written even while held", () => {
    mockServerTime = 50_000;
    const entity = entityOf([snap(40_000, 3)]);
    const playback = new PosePlayback();
    const first = target();
    playback.sample(entity, 0.016, first);
    playback.sample(entity, 0.016, first);
    const second = target();
    playback.sample(entity, 0.016, second);
    expect(second.valid).toBe(true);
    expect(second.x).toBe(3);
  });
});
