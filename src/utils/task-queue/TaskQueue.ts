type Task = () => Promise<void>;

/** Heavy tasks yield to the browser between slices so a burst of queued work can't stack into one frame. */
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
      // Awaiting a synchronous task only yields a MICROtask, which never lets the browser render.
      if (performance.now() - sliceStart > SLICE_BUDGET_MS) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        sliceStart = performance.now();
      }
      const { task } = this.queue.shift()!;
      // The budget must count SYNCHRONOUS time only: a task awaiting a worker
      // round-trip suspends across a macrotask boundary (the browser already
      // rendered), but wall-clock counted that wait and forced a yield after every
      // such task. This self-rearming zero-timeout can only fire while the task is
      // suspended, and each fire restarts the slice clock at that boundary.
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
