import type { PointXZ } from "../math/types";

type Task = () => Promise<void>;

export interface TaskQueueOptions {
  /** Multiplies a task's distance to the focus: below 1 is more urgent, above 1 less. Default 1. */
  weight?: number;
  /** Added to every task's rank. BACKGROUND_RANK makes the whole queue background work. Default 0. */
  bias?: number;
}

export interface TaskOptions {
  /** Where in the world the work is for. The task is ranked by its distance from here to the focus
   *  (the camera), re-measured every time a task is picked. Without it the rank is the queue's bias. */
  at?: PointXZ;
}

/**
 * Every TaskQueue shares ONE frame budget: all queues together run at most ~FRAME_BUDGET_MS of
 * queued work per frame, then wait for the next frame. Each queue budgeting only itself let four
 * backlogged queues (buildings, GLTF clones, dressing, city lights) run their slices back to back
 * (measured, city-entry burst: p95 15.7ms of queued work between two frames → 7.7ms; CLAUDE.md
 * Performance Notes).
 *
 * PRIORITY: every task has a RANK = (distance from its `at` to the focus) × the queue's weight + the
 * queue's bias, and the lowest rank in any queue runs next. Ranks are re-measured at every pick, so
 * work the player has driven past falls behind the work in front of them. A queue still runs one
 * task at a time (a task may await a worker), but picks any of its tasks, not just the oldest; equal
 * ranks keep insertion order, and between queues the one that has used the least time wins a tie.
 * A queue awaiting a worker does not hold up the others.
 *
 * BACKGROUND work (rank above BACKGROUND_RANK) only runs in the budget the nearer work left over, and
 * while the machine is struggling (frames slower than STRUGGLING_FRAME_MS) only in the first
 * STRUGGLING_BACKGROUND_SHARE of it: the frame time goes back to rendering instead.
 */
const FRAME_BUDGET_MS = 6;
/** Below ~30fps the budget grows to this share of the frame, up to MAX_FRAME_BUDGET_MS: a flat 6ms
 *  on a 10fps machine would stream buildings 15× slower than on a 144fps one. */
const SLOW_FRAME_SHARE = 0.2;
const MAX_FRAME_BUDGET_MS = 50;
/** A hidden tab gets no animation frames; this timer stands in for them. */
const HIDDEN_FRAME_FALLBACK_MS = 250;

/** Ranks above this are background: a building beyond 600u, a dressing chunk beyond 400u (weight 1.5). */
export const BACKGROUND_RANK = 600;
/** Below 40fps. */
const STRUGGLING_FRAME_MS = 25;
const STRUGGLING_BACKGROUND_SHARE = 0.25;

const now = () => performance.now();

const hasFrames = typeof requestAnimationFrame === "function" && typeof document !== "undefined";

let budget = FRAME_BUDGET_MS;
let usedThisFrame = 0;
let frameArmed = false;
let armedAt = 0;
let lastFrameAt = -Infinity;
let frameIntervalEma = 0;
/** Time of the latest macrotask boundary seen while a task was suspended (see charge in settle). */
let lastBoundary = -Infinity;
let inFlight = 0;
let boundaryTimer: ReturnType<typeof setTimeout> | null = null;

let focusX = 0;
let focusZ = 0;
/** Bumped per drain: a task's rank is measured once per drain (the focus cannot move inside one). */
let rankEpoch = 0;

const active = new Set<TaskQueue>();
let draining = false;
let drainPosted = false;

let channel: MessageChannel | null = null;
const postMacrotask = (fn: () => void): void => {
  if (typeof MessageChannel === "undefined") {
    setTimeout(fn, 0);
    return;
  }
  if (!channel) {
    channel = new MessageChannel();
    (channel.port1 as { unref?: () => void }).unref?.();
  }
  channel.port1.onmessage = fn;
  channel.port2.postMessage(null);
};

const onNextFrame = (fn: () => void): void => {
  if (!hasFrames) {
    setTimeout(fn, 0);
    return;
  }
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    clearTimeout(fallback);
    fn();
  };
  const fallback = setTimeout(fire, HIDDEN_FRAME_FALLBACK_MS);
  requestAnimationFrame(fire);
};

/** While any queue has work the frame re-arms itself at each frame, so an interval whose arm came
 *  right at the previous frame is a real frame; after an idle gap the first interval is the gap. */
const measureFrame = (t: number): void => {
  const interval = t - lastFrameAt;
  if (armedAt - lastFrameAt < 1 && interval < 2000) {
    frameIntervalEma = frameIntervalEma === 0 ? interval : frameIntervalEma * 0.8 + interval * 0.2;
    budget = Math.min(Math.max(FRAME_BUDGET_MS, frameIntervalEma * SLOW_FRAME_SHARE), MAX_FRAME_BUDGET_MS);
  }
  lastFrameAt = t;
};

const armFrame = (): void => {
  if (frameArmed) return;
  frameArmed = true;
  armedAt = now();
  onNextFrame(() => {
    frameArmed = false;
    measureFrame(now());
    // An overrun borrows from the next frame, at most one budget, so one huge task cannot stall every
    // queue for several frames.
    usedThisFrame = Math.min(Math.max(usedThisFrame - budget, 0), budget);
    if (usedThisFrame > 0 || active.size > 0) armFrame();
    requestDrain();
  });
};

const charge = (queue: TaskQueue | null, ms: number): void => {
  usedThisFrame += ms;
  if (queue) queue.usedMs += ms;
  armFrame();
};

// Self-rearming zero-timeout: it can only fire while every running task is suspended, so each fire
// marks a macrotask boundary. A task resuming after a worker round-trip is charged only from the
// last boundary — the wait itself is not work.
const onBoundary = (): void => {
  lastBoundary = now();
  boundaryTimer = inFlight > 0 ? setTimeout(onBoundary, 0) : null;
};

/** Where the player is: every positioned task is ranked by its distance to here. Set once per frame. */
export const setWorkFocus = (x: number, z: number): void => {
  focusX = x;
  focusZ = z;
};

/** True while frames are slower than STRUGGLING_FRAME_MS — when far work should yield. */
export const isMachineStruggling = (): boolean => frameIntervalEma > STRUGGLING_FRAME_MS;

/** Main-thread generation that runs outside a queue (terrain chunk finishing) spends the same frame
 *  budget, so the queues back off after it. */
export const chargeFrameWork = (ms: number): void => charge(null, ms);

const backgroundAllowance = (): number =>
  isMachineStruggling() ? budget * STRUGGLING_BACKGROUND_SHARE : budget;

const pickNext = (): { queue: TaskQueue; index: number } | null => {
  let bestQueue: TaskQueue | null = null;
  let bestIndex = -1;
  let bestRank = Infinity;
  for (const q of active) {
    if (!q.ready) continue;
    const { index, rank } = q.best();
    if (rank < bestRank || (rank === bestRank && bestQueue !== null && q.usedMs < bestQueue.usedMs)) {
      bestQueue = q;
      bestIndex = index;
      bestRank = rank;
    }
  }
  if (!bestQueue) return null;
  if (bestRank > BACKGROUND_RANK && usedThisFrame >= backgroundAllowance()) return null;
  return { queue: bestQueue, index: bestIndex };
};

const drain = (): void => {
  drainPosted = false;
  if (draining) return;
  draining = true;
  rankEpoch++;
  try {
    while (usedThisFrame < budget) {
      const next = pickNext();
      if (!next) break;
      next.queue.runAt(next.index);
    }
  } finally {
    draining = false;
  }
  for (const q of active) {
    if (q.ready) {
      armFrame();
      break;
    }
  }
};

function requestDrain(): void {
  if (drainPosted || draining) return;
  drainPosted = true;
  postMacrotask(drain);
}

interface QueuedTask {
  id: string;
  task: Task;
  at: PointXZ | undefined;
  rank: number;
  rankEpoch: number;
}

export class TaskQueue {
  private queue: QueuedTask[] = [];
  private running = false;
  private taskIdCounter = 0;
  private readonly weight: number;
  private readonly bias: number;
  /** @internal Time charged to this queue — the tie-break between equal ranks. */
  usedMs = 0;

  constructor({ weight = 1, bias = 0 }: TaskQueueOptions = {}) {
    this.weight = weight;
    this.bias = bias;
  }

  public addTask(task: Task, { at }: TaskOptions = {}): string {
    const taskId = `task-${this.taskIdCounter++}`;
    this.queue.push({ id: taskId, task, at, rank: 0, rankEpoch: -1 });
    if (!active.has(this)) {
      // A queue waking up joins at the others' level, not with credit for the time it sat idle.
      let floor = Infinity;
      for (const q of active) floor = Math.min(floor, q.usedMs);
      if (floor !== Infinity) this.usedMs = Math.max(this.usedMs, floor);
      active.add(this);
    }
    if (usedThisFrame < budget) requestDrain();
    else armFrame();
    return taskId;
  }

  public removeTask(taskId: string): boolean {
    const index = this.queue.findIndex((item) => item.id === taskId);
    if (index >= 0) this.queue.splice(index, 1);
    if (this.queue.length === 0 && !this.running) active.delete(this);
    return index >= 0;
  }

  /** @internal The scheduler's view; callers use addTask/removeTask. */
  get ready(): boolean {
    return !this.running && this.queue.length > 0;
  }

  /** @internal The lowest-ranked task; the first of equals, so unpositioned queues stay FIFO. */
  best(): { index: number; rank: number } {
    let index = 0;
    let rank = Infinity;
    for (let i = 0; i < this.queue.length; i++) {
      const item = this.queue[i];
      if (item.rankEpoch !== rankEpoch) {
        item.rankEpoch = rankEpoch;
        item.rank = item.at
          ? Math.hypot(item.at.x - focusX, item.at.z - focusZ) * this.weight + this.bias
          : this.bias;
      }
      if (item.rank < rank) {
        rank = item.rank;
        index = i;
      }
    }
    return { index, rank };
  }

  /** @internal Starts a task; the budget is charged for its synchronous part now, the rest when it settles. */
  runAt(index: number): void {
    const { task } = this.queue.splice(index, 1)[0];
    this.running = true;
    inFlight++;
    if (boundaryTimer === null) boundaryTimer = setTimeout(onBoundary, 0);
    const start = now();
    let pending: Promise<void>;
    try {
      pending = task();
    } catch (error) {
      pending = Promise.reject(error);
    }
    const syncEnd = now();
    charge(this, syncEnd - start);
    const settle = () => {
      charge(this, now() - Math.max(syncEnd, lastBoundary));
      this.running = false;
      inFlight--;
      if (this.queue.length === 0) active.delete(this);
      if (usedThisFrame < budget) drain();
      else armFrame();
    };
    pending.then(settle, (error) => {
      console.error("Error processing task:", error);
      settle();
    });
  }
}
