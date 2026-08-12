type Task = () => Promise<void>;

/** Main-thread budget per processing slice — heavy tasks (collider builds,
 *  building geometry) yield to the browser between slices so a burst of
 *  spawns can't stack synchronous work into a single frame. */
const SLICE_BUDGET_MS = 6;

export class TaskQueue {
  private queue: { id: string; task: Task }[] = [];
  private isProcessing = false;
  private taskIdCounter = 0;

  public addTask(task: Task): string {
    const taskId = `task-${this.taskIdCounter++}`;
    this.queue.push({ id: taskId, task });
    this.processQueue();
    return taskId;
  }

  public removeTask(taskId: string): boolean {
    const initialLength = this.queue.length;
    this.queue = this.queue.filter((item) => item.id !== taskId);
    return initialLength !== this.queue.length;
  }

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    let sliceStart = performance.now();
    while (this.queue.length > 0) {
      // Yield a macrotask once the slice budget is spent (awaiting a
      // synchronous task only yields a MICROtask, which never lets the
      // browser render — without this, N queued tasks run in one frame).
      if (performance.now() - sliceStart > SLICE_BUDGET_MS) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        sliceStart = performance.now();
      }
      const { task } = this.queue.shift()!;
      // The budget must measure SYNCHRONOUS main-thread time only. A task
      // that awaits a worker round-trip suspends across a macrotask boundary
      // — the browser already got its render turn there — but the wall-clock
      // check above counted that idle wait, exhausted the budget every time,
      // and inserted a (latency-adding) setTimeout yield between every such
      // task. A self-rearming zero-timeout races the task: it can only fire
      // while the task is suspended past a macrotask boundary, and each fire
      // restarts the slice clock at that boundary (so only the task's
      // synchronous tail after the last suspension keeps accumulating).
      // Purely synchronous tasks resolve through microtasks alone — the
      // timer never fires and their full cost still counts toward the slice.
      let boundaryTimer: ReturnType<typeof setTimeout>;
      const onMacrotaskBoundary = () => {
        sliceStart = performance.now();
        boundaryTimer = setTimeout(onMacrotaskBoundary, 0);
      };
      boundaryTimer = setTimeout(onMacrotaskBoundary, 0);
      try {
        await task();
      } catch (error) {
        console.error("Error processing task:", error);
      } finally {
        clearTimeout(boundaryTimer);
      }
    }

    this.isProcessing = false;
  }
}
