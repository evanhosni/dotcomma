export interface SplashEmitterParams {
  /** About one emitter per 2 × spacing² of the plunge pool. */
  spacing: number;
  /** Particles per emitter (scaled over COUNT_RANGE by its own roll, a burst's by its rock's size). */
  count: number;
}

export interface SplashEmitter {
  x: number;
  y: number;
  z: number;
  /** Downstream (world). */
  dirX: number;
  dirZ: number;
  /** 0–1, from the fall's grade. */
  strength: number;
  count: number;
  /** 1 at a boulder's face, 0 in a plunge pool. */
  burst: number;
}
