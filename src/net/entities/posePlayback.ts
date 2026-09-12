import { getServerTime } from "../connection";
import type { ClientEntity } from "./entityStore";
import { advanceRenderClock, INTERP_DELAY_MS, pruneSnapshots, sampleSnapshots, type SampledPose, type SampleStatus } from "./interpolation";
import type { PuppetTarget } from "./useSyncedEntity";

/**
 * POSE PLAYBACK — one synced actor's view of the server's published track:
 * a per-actor RENDER CLOCK that slews toward (server time − INTERP_DELAY_MS)
 * and the snapshot sampler (interpolation.ts). The actor base owns one per
 * instance and asks it every frame where the entity is right now.
 *
 * Why a clock per actor: it converges on the target by running at most ±10%
 * fast or slow, so a re-estimated server-clock offset (a pong with a better
 * RTT) never steps the picture; only a gross error snaps.
 */
export class PosePlayback {
  private clock = NaN;
  private readonly sampled: SampledPose = { x: 0, y: 0, z: 0, ry: 0, vx: 0, vy: 0, vz: 0 };

  /** The delayed server time this actor is drawn at (NaN before the first sample). */
  get renderTime(): number {
    return this.clock;
  }

  /** Advance by `deltaS` seconds and write the pose at the render time into
   *  `target` (untouched when the track has no samples yet). */
  sample(entity: ClientEntity, deltaS: number, target: PuppetTarget): SampleStatus {
    const dtMs = Math.min(deltaS, 0.25) * 1000;
    this.clock = advanceRenderClock(this.clock, dtMs, getServerTime() - INTERP_DELAY_MS);
    const snaps = entity.snapshots;
    pruneSnapshots(snaps, this.clock);
    const status = sampleSnapshots(snaps, this.clock, this.sampled);
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

  /** Forget the clock (the actor stopped being synced). */
  reset(): void {
    this.clock = NaN;
  }
}
