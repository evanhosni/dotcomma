import { getServerTime } from "../connection";
import type { ClientEntity } from "./entityStore";
import {
  advanceRenderClock,
  INTERP_DELAY_MS,
  MAX_EXTRAPOLATION_MS,
  pruneSnapshots,
  sampleSnapshots,
  type SampledPose,
  type SampleStatus,
  type Snapshot,
} from "./interpolation";
import type { PuppetTarget } from "./useSyncedEntity";

/** The track's lone snapshot once the render clock is past extrapolating it (sampling holds it); else null. */
const playedOutSnapshot = (snaps: Snapshot[], renderTime: number): Snapshot | null =>
  snaps.length === 1 && renderTime - snaps[0].st > MAX_EXTRAPOLATION_MS ? snaps[0] : null;

/**
 * One synced actor's playback of the server's track: a per-actor render clock that
 * slews (±10%) toward server time − INTERP_DELAY_MS, so a re-estimated clock offset
 * never steps the picture, plus the snapshot sampler (interpolation.ts).
 */
export class PosePlayback {
  private renderClock = NaN;
  private readonly sampled: SampledPose = { x: 0, y: 0, z: 0, ry: 0, vx: 0, vy: 0, vz: 0 };
  /** The lone snapshot a track has played out to: past MAX_EXTRAPOLATION_MS it samples to the same held
   *  pose every frame until another arrives (a pushed or replaced snapshot is a new object). Every
   *  building is such a track for its whole life, so its frames skip the sampling. */
  private heldOn: Snapshot | null = null;
  /** The target that held pose was written to. */
  private heldTarget: PuppetTarget | null = null;

  /** NaN before the first sample. */
  get renderTime(): number {
    return this.renderClock;
  }

  /** `target` is left untouched while the track has no samples. */
  sample(entity: ClientEntity, deltaS: number, target: PuppetTarget): SampleStatus {
    const dtMs = Math.min(deltaS, 0.25) * 1000;
    this.renderClock = advanceRenderClock(this.renderClock, dtMs, getServerTime() - INTERP_DELAY_MS);
    const snaps = entity.snapshots;
    const held = this.heldOn;
    if (held !== null && target === this.heldTarget && playedOutSnapshot(snaps, this.renderClock) === held) return "hold";
    pruneSnapshots(snaps, this.renderClock);
    const status = sampleSnapshots(snaps, this.renderClock, this.sampled);
    this.heldOn = status === "hold" ? playedOutSnapshot(snaps, this.renderClock) : null;
    this.heldTarget = target;
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
    this.heldOn = null;
  }
}
