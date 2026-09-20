import { getServerTime } from "../connection";
import type { ClientEntity } from "./entityStore";
import { advanceRenderClock, INTERP_DELAY_MS, pruneSnapshots, sampleSnapshots, type SampledPose, type SampleStatus } from "./interpolation";
import type { PuppetTarget } from "./useSyncedEntity";

/**
 * One synced actor's playback of the server's track: a per-actor render clock that
 * slews (±10%) toward server time − INTERP_DELAY_MS, so a re-estimated clock offset
 * never steps the picture, plus the snapshot sampler (interpolation.ts).
 */
export class PosePlayback {
  private renderClock = NaN;
  private readonly sampled: SampledPose = { x: 0, y: 0, z: 0, ry: 0, vx: 0, vy: 0, vz: 0 };

  /** NaN before the first sample. */
  get renderTime(): number {
    return this.renderClock;
  }

  /** `target` is left untouched while the track has no samples. */
  sample(entity: ClientEntity, deltaS: number, target: PuppetTarget): SampleStatus {
    const dtMs = Math.min(deltaS, 0.25) * 1000;
    this.renderClock = advanceRenderClock(this.renderClock, dtMs, getServerTime() - INTERP_DELAY_MS);
    const snaps = entity.snapshots;
    pruneSnapshots(snaps, this.renderClock);
    const status = sampleSnapshots(snaps, this.renderClock, this.sampled);
    if (status !== "none") {
      const s = this.sampled;
      target.x = s.x;
      target.y = s.y;
      target.z = s.z;
      target.ry = s.ry;
      target.vx = s.vx;
      target.vy = s.vy;
      target.vz = s.vz;
      target.valid = true;
    }
    return status;
  }

  reset(): void {
    this.renderClock = NaN;
  }
}
