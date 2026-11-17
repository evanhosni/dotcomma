import type { PointXZ } from "../math/types";

export interface TaskQueueOptions {
  /** Multiplies a task's distance to the focus: below 1 is more urgent, above 1 less. Default 1. */
  weight?: number;
  /** Added to every task's rank. BACKGROUND_RANK makes the whole queue background work. Default 0. */
  bias?: number;
  /** How many of its tasks may be in flight at once (default 1). A queue whose tasks await a worker
   *  ran one round trip at a time: the worker idled through every reply's trip back, the main thread's
   *  turn and the next request's trip out. Each task is still picked by rank and charged to the budget. */
  concurrency?: number;
}

export interface TaskOptions {
  /** Where in the world the work is for. The task is ranked by its distance from here to the focus
   *  (the camera), re-measured every time a task is picked. Without it the rank is the queue's bias. */
  at?: PointXZ;
  /** Multiplies this task's distance on top of its queue's weight (default 1). */
  weight?: number;
}
