import type * as THREE from "three";

export type AnimationLoop = "repeat" | "once" | "pingpong";

export interface AnimationParams {
  loop: AnimationLoop;
  /** Clip seconds per second. */
  speed: number;
  reverse: boolean;
  /** Pose updates per second; 0 = every rendered frame. */
  frameRate: number;
  /** 0..1: how far the pose moves from the rest pose toward the clip. */
  intensity: number;
  /** Seconds a newly played clip cross-fades from the previous one's last pose. */
  fade: number;
}

export interface AnimationSpec extends Partial<AnimationParams> {
  clip: string;
  /** Default: false for "repeat"/"pingpong" (re-entering keeps the phase), true for "once". */
  restart?: boolean;
}

/** Self-describing and flat, so the server publishes it as is and every client poses the same frame. */
export interface AnimationState extends AnimationParams {
  /** null = stopped. */
  clip: string | null;
  paused: boolean;
  /** Unwrapped clip seconds at `anchor`. */
  origin: number;
  /** Channel-clock ms the playhead is measured from. */
  anchor: number;
  /** Channel-clock ms of the last change: readers on a delayed clock apply the state once they reach it. */
  changedAt: number;
  /** The clip faded out of, held at `fadeTime` seconds, from `fadeStart` ms over `fade` seconds. */
  fadeClip: string | null;
  fadeTime: number;
  fadeStart: number;
}

export type ClipDurations = Readonly<Record<string, number>>;

export interface ProceduralPose {
  /** `time` in clip seconds, `weight` the intensity (and fade) applied. */
  pose(time: number, weight: number): void;
  /** Restores everything `pose` touched (the clone is pooled). */
  dispose(): void;
}

/** A clip computed in code instead of keyframed in the model; the channel plays it by `name` like any other. */
export interface ProceduralClip {
  name: string;
  duration: number;
  create(root: THREE.Object3D): ProceduralPose;
}

/** Values a behavior hands the procedural layers (a head's yaw); undefined = leave the clip's pose. */
export type AnimationInputs = Record<string, number | undefined>;

export interface ProceduralLayerPose {
  pose(inputs: Readonly<AnimationInputs>, weight: number): void;
  dispose(): void;
}

/** Always on: posed over whatever clip plays, on that clip's frame grid, from the channel's inputs. */
export interface ProceduralLayer {
  name: string;
  create(root: THREE.Object3D): ProceduralLayerPose;
}

/** An actor's animation knobs: channel defaults, its procedural clips and its layers. */
export interface AnimationConfig extends Partial<AnimationParams> {
  procedural?: readonly ProceduralClip[];
  layers?: readonly ProceduralLayer[];
}

export interface AnimationChannelOptions {
  defaults?: Partial<AnimationParams>;
  /** Lets reversal and seeking clamp one-shots and start reversed clips at their end. */
  durations?: ClipDurations;
}
